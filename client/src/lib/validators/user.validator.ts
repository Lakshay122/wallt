import { z } from 'zod';

export const createAgentSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  email: z.string().email('Invalid email address').optional(),
});

export const updateStatusSchema = z.object({
  isActive: z.boolean({
    required_error: 'isActive is required',
  }),
});
