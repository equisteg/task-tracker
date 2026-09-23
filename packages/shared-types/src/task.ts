export type TaskPriority = 'Low' | 'Normal' | 'High' | 'Urgent';
export type TaskStatus = 'Pending' | 'In Progress' | 'Blocked' | 'Completed' | 'Unassigned';

export interface TaskAttachment {
  name: string;
  url: string;
  type?: string;
  size?: number;
}

export interface TaskHistoryEntry {
  timestamp: string;
  actor: string;
  change: string;
}

export interface Task {
  id: string;
  title: string;
  desc: string;
  teamId: string;
  assigneeId: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
  tags: string[];
  slaHours?: number;
  createdAt?: string;
  attachments?: TaskAttachment[];
  history?: TaskHistoryEntry[];
}
