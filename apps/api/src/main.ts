import express from 'express';
import cors from 'cors';
import { tasksRouter } from './routes/tasks';
import { authRouter } from './routes/auth';
import { paymentsRouter } from './routes/payments';
import { sentinelRouter } from './routes/sentinel';

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/tasks', tasksRouter);
app.use('/api/auth', authRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/sentinel', sentinelRouter);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Product Backend API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.listen(port, () => {
  console.log(`[Product API] Server running on http://localhost:${port}`);
  console.log(`[Product API] Merchant Payout Settlement Service initialized.`);
});
