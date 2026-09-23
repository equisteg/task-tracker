import { Router, Request, Response } from 'express';

export const authRouter = Router();

authRouter.post('/login', (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and passphrase required' });
  }

  res.json({
    success: true,
    token: 'jwt-sha256.' + Buffer.from(email).toString('base64'),
    user: { email, role: 'Admin' }
  });
});
