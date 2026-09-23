import { Router, Request, Response } from 'express';

export const tasksRouter = Router();

let mockTasks: any[] = [
  {
    id: 'TSK-101',
    title: 'Initialize Zero-Trust Architecture Baseline',
    desc: 'Configure certificate pinning, tenant boundaries, and cryptographic ledgers.',
    teamId: 'team-ops',
    assigneeId: 'user-admin-1',
    status: 'In Progress',
    priority: 'High',
    dueDate: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    tags: ['Security', 'Zero-Trust']
  }
];

tasksRouter.get('/', (_req: Request, res: Response) => {
  res.json({ success: true, count: mockTasks.length, data: mockTasks });
});

tasksRouter.post('/', (req: Request, res: Response) => {
  const newTask = {
    id: 'TSK-' + Date.now().toString().slice(-4),
    ...req.body,
    createdAt: new Date().toISOString()
  };
  mockTasks.unshift(newTask);
  res.status(201).json({ success: true, data: newTask });
});
