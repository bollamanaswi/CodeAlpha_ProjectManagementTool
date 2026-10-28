require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { User, Project, Task, Comment } = require('./models');

const app = express();
const server = http.createServer(app);
const allowedOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const io = new Server(server, { cors: { origin: allowedOrigin, methods: ['GET', 'POST', 'PATCH'] } });
app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '1mb' }));

const tokenFor = (user) => jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '7d' });
const safeUser = (user) => ({ id: user._id, name: user.name, email: user.email });
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

app.get('/api/health', (_req, res) => res.json({ ok: true, database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!name || !email || password.length < 8) return res.status(400).json({ message: 'Name, email, and a password of at least 8 characters are required.' });
  if (await User.exists({ email })) return res.status(409).json({ message: 'An account with this email already exists.' });
  const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12) });
  res.status(201).json({ token: tokenFor(user), user: safeUser(user) });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.passwordHash))) {
    return res.status(401).json({ message: 'Email or password is incorrect.' });
  }
  res.json({ token: tokenFor(user), user: safeUser(user) });
}));

const requireAuth = asyncRoute(async (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ message: 'Sign in to continue.' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.sub);
    if (!req.user) return res.status(401).json({ message: 'Your account is no longer available.' });
    next();
  } catch {
    return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
  }
});

const projectForMember = async (projectId, userId) => {
  if (!mongoose.isValidObjectId(projectId)) return null;
  return Project.findOne({ _id: projectId, members: userId });
};

app.use('/api', requireAuth);
app.get('/api/me', (req, res) => res.json({ user: safeUser(req.user) }));

app.get('/api/projects', asyncRoute(async (req, res) => {
  const projects = await Project.find({ members: req.user._id }).sort({ updatedAt: -1 })
    .populate('owner', 'name email').populate('members', 'name email');
  res.json({ projects });
}));

app.post('/api/projects', asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  if (!name) return res.status(400).json({ message: 'Project name is required.' });
  const project = await Project.create({ name, description, owner: req.user._id, members: [req.user._id] });
  const populated = await project.populate(['owner', 'members']);
  res.status(201).json({ project: populated });
}));

app.post('/api/projects/:projectId/members', asyncRoute(async (req, res) => {
  const project = await projectForMember(req.params.projectId, req.user._id);
  if (!project) return res.status(404).json({ message: 'Project not found.' });
  if (!project.owner.equals(req.user._id)) return res.status(403).json({ message: 'Only the project owner can invite members.' });
  const email = String(req.body.email || '').trim().toLowerCase();
  const invitee = await User.findOne({ email });
  if (!invitee) return res.status(404).json({ message: 'No account found for that email. Ask them to sign up first.' });
  if (!project.members.some((id) => id.equals(invitee._id))) project.members.push(invitee._id);
  await project.save();
  const populated = await project.populate(['owner', 'members']);
  io.to(`project:${project.id}`).emit('project:updated', { project: populated, actorId: req.user.id });
  res.json({ project: populated });
}));

app.get('/api/projects/:projectId/tasks', asyncRoute(async (req, res) => {
  const project = await projectForMember(req.params.projectId, req.user._id);
  if (!project) return res.status(404).json({ message: 'Project not found.' });
  const tasks = await Task.find({ project: project._id }).sort({ updatedAt: -1 })
    .populate('assignee', 'name email').populate('createdBy', 'name email');
  res.json({ tasks });
}));

app.post('/api/projects/:projectId/tasks', asyncRoute(async (req, res) => {
  const project = await projectForMember(req.params.projectId, req.user._id);
  if (!project) return res.status(404).json({ message: 'Project not found.' });
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ message: 'Task title is required.' });
  let assignee = null;
  if (req.body.assigneeId) {
    const isMember = project.members.some((id) => id.equals(req.body.assigneeId));
    if (!isMember) return res.status(400).json({ message: 'Assignee must be a project member.' });
    assignee = req.body.assigneeId;
  }
  const task = await Task.create({ project: project._id, title, description: req.body.description || '', status: req.body.status || 'todo', priority: req.body.priority || 'medium', assignee, createdBy: req.user._id, dueDate: req.body.dueDate || null });
  const populated = await task.populate(['assignee', 'createdBy']);
  io.to(`project:${project.id}`).emit('task:created', { task: populated, actorId: req.user.id });
  res.status(201).json({ task: populated });
}));

app.patch('/api/tasks/:taskId', asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.taskId)) return res.status(404).json({ message: 'Task not found.' });
  const task = await Task.findById(req.params.taskId);
  if (!task) return res.status(404).json({ message: 'Task not found.' });
  const project = await projectForMember(task.project, req.user._id);
  if (!project) return res.status(404).json({ message: 'Task not found.' });
  const allowed = ['title', 'description', 'status', 'priority', 'dueDate'];
  for (const field of allowed) if (field in req.body) task[field] = req.body[field];
  if ('assigneeId' in req.body) {
    const assigneeId = req.body.assigneeId || null;
    if (assigneeId && !project.members.some((id) => id.equals(assigneeId))) return res.status(400).json({ message: 'Assignee must be a project member.' });
    task.assignee = assigneeId;
  }
  await task.save();
  const populated = await task.populate(['assignee', 'createdBy']);
  io.to(`project:${project.id}`).emit('task:updated', { task: populated, actorId: req.user.id });
  res.json({ task: populated });
}));

app.get('/api/tasks/:taskId/comments', asyncRoute(async (req, res) => {
  const task = await Task.findById(req.params.taskId);
  if (!task || !(await projectForMember(task.project, req.user._id))) return res.status(404).json({ message: 'Task not found.' });
  const comments = await Comment.find({ task: task._id }).sort({ createdAt: 1 }).populate('author', 'name email');
  res.json({ comments });
}));

app.post('/api/tasks/:taskId/comments', asyncRoute(async (req, res) => {
  const task = await Task.findById(req.params.taskId);
  if (!task || !(await projectForMember(task.project, req.user._id))) return res.status(404).json({ message: 'Task not found.' });
  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ message: 'Comment cannot be empty.' });
  const comment = await Comment.create({ task: task._id, project: task.project, author: req.user._id, body });
  const populated = await comment.populate('author', 'name email');
  io.to(`project:${task.project}`).emit('comment:created', { comment: populated, taskId: task.id, actorId: req.user.id });
  res.status(201).json({ comment: populated });
}));

io.use(async (socket, next) => {
  try {
    const decoded = jwt.verify(socket.handshake.auth?.token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.sub).select('_id');
    if (!user) return next(new Error('Unauthorized'));
    socket.userId = user.id;
    next();
  } catch { next(new Error('Unauthorized')); }
});
io.on('connection', (socket) => {
  socket.on('project:join', async (projectId) => {
    if (await projectForMember(projectId, socket.userId)) socket.join(`project:${projectId}`);
  });
  socket.on('project:leave', (projectId) => socket.leave(`project:${projectId}`));
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  if (err?.code === 11000) return res.status(409).json({ message: 'That value is already in use.' });
  if (err?.name === 'ValidationError' || err?.name === 'CastError') return res.status(400).json({ message: 'Please check the values and try again.' });
  console.error('Request failed:', err.message);
  res.status(500).json({ message: 'Something went wrong. Please try again.' });
});

async function start() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required. Add it to your local .env file.');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required. Add it to your local .env file.');
  await mongoose.connect(process.env.MONGODB_URI);
  const port = Number(process.env.PORT || 4000);
  server.listen(port, () => console.log(`Taskflow API listening on http://localhost:${port}`));
}

if (require.main === module) start().catch((err) => { console.error('Startup failed:', err.message); process.exit(1); });
module.exports = { app, server, io };

