import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(160, '邮箱过长')
  .email('邮箱格式不正确');

/** 只做长度兜底，强度校验在 PasswordService 里（要带上下文，比如不能等于邮箱） */
export const rawPasswordSchema = z.string().min(1, '请输入密码').max(128, '密码过长');

export const registerSchema = z.object({
  email: emailSchema,
  password: rawPasswordSchema,
  nickname: z.string().trim().max(40, '昵称过长').optional(),
  inviteCode: z.string().trim().max(64).optional(),
  deviceName: z.string().trim().max(80).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: rawPasswordSchema,
  deviceName: z.string().trim().max(80).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20, 'refreshToken 不合法').max(200),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(20).max(200).optional(),
  /** 为 true 时退出所有设备的登录 */
  allDevices: z.boolean().optional(),
});
export type LogoutInput = z.infer<typeof logoutSchema>;

export const changePasswordSchema = z.object({
  oldPassword: rawPasswordSchema,
  newPassword: rawPasswordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const sessionIdParamSchema = z.object({
  id: z.string().uuid('会话 id 不正确'),
});
