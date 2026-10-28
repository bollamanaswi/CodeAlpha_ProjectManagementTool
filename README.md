# Taskflow

A full-stack collaborative project board. Teams can create projects, invite registered members, assign tasks, discuss work in comments, and see project updates live.

## Stack

- React 18 + Vite
- Node.js + Express
- MongoDB + Mongoose
- JWT sessions with bcrypt password hashing
- Socket.IO for live board updates and notifications

## Requirements

- Node.js 20 or newer
- MongoDB Atlas or a local MongoDB server

## Run locally

1. Copy `.env.example` to `.env` and set `MONGODB_URI` and a long random `JWT_SECRET`.
2. Install dependencies: `npm install`
3. Start the API and frontend: `npm run dev`
4. Open `http://localhost:5173`.

The API listens on port 4000 by default. Vite proxies `/api` and Socket.IO to it. In production, run `npm run build`, set `NODE_ENV=production`, and start the API with `npm start`.

## Features

- Sign up and sign in with email/password
- Create project boards and invite existing accounts by email
- Create tasks, set priority and due date, and assign project members
- Drag cards across To do, In progress, and Done
- Edit status or assignee from the task detail panel
- Comment on tasks and receive live updates through Socket.IO
- Project membership is checked for every board API and socket room

## API overview

All endpoints below except health and authentication require `Authorization: Bearer <token>`.

- `POST /api/auth/register`, `POST /api/auth/login`
- `GET /api/projects`, `POST /api/projects`
- `POST /api/projects/:projectId/members`
- `GET /api/projects/:projectId/tasks`, `POST /api/projects/:projectId/tasks`
- `PATCH /api/tasks/:taskId`
- `GET /api/tasks/:taskId/comments`, `POST /api/tasks/:taskId/comments`
- `GET /api/health`

## Security notes

Keep `.env` local. It is ignored by Git. Only `.env.example` is intended to be committed. Use HTTPS and a strong, unique JWT secret when deploying.
