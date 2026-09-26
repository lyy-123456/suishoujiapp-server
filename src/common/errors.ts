/**
 * 业务错误码表与 AppError。
 * 约定：HTTP 状态码表达"传输层语义"，code 表达"业务语义"，客户端主要看 code。
 */
export const ErrorCode = {
  OK: 0,
  /** 参数校验失败（details 里带字段级错误） */
  INVALID_PARAMS: 1001,
  /** 未登录 / 令牌过期（客户端应触发 refresh） */
  UNAUTHORIZED: 1002,
  /** 无权限（含越权访问他人数据） */
  FORBIDDEN: 1003,
  NOT_FOUND: 1004,
  /** 版本冲突：返回服务端最新记录 */
  CONFLICT: 1009,
  /** 文件过大 */
  TOO_LARGE: 1013,
  /** 文件类型不允许 */
  UNSUPPORTED_TYPE: 1015,
  /** 触发限流 */
  RATE_LIMITED: 1029,
  /** 账号被锁定（登录失败过多） */
  ACCOUNT_LOCKED: 2001,
  /** 账号被禁用 */
  ACCOUNT_DISABLED: 2002,
  INTERNAL: 5000,
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  readonly code: number;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: number, message: string, httpStatus = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }

  static invalidParams(message = '参数校验失败', details?: unknown): AppError {
    return new AppError(ErrorCode.INVALID_PARAMS, message, 400, details);
  }

  static unauthorized(message = '登录状态已失效，请重新登录'): AppError {
    return new AppError(ErrorCode.UNAUTHORIZED, message, 401);
  }

  static forbidden(message = '没有权限执行该操作'): AppError {
    return new AppError(ErrorCode.FORBIDDEN, message, 403);
  }

  static notFound(message = '资源不存在'): AppError {
    return new AppError(ErrorCode.NOT_FOUND, message, 404);
  }

  static conflict(message = '数据已被其他设备修改'): AppError {
    return new AppError(ErrorCode.CONFLICT, message, 409);
  }

  static rateLimited(message = '操作过于频繁，请稍后再试'): AppError {
    return new AppError(ErrorCode.RATE_LIMITED, message, 429);
  }

  static accountLocked(message = '尝试次数过多，请稍后再试'): AppError {
    return new AppError(ErrorCode.ACCOUNT_LOCKED, message, 423);
  }
}

/** HTTP 状态码 → 业务码（用于把 Nest 内置异常归一化） */
export function codeFromHttpStatus(status: number): number {
  switch (status) {
    case 400:
      return ErrorCode.INVALID_PARAMS;
    case 401:
      return ErrorCode.UNAUTHORIZED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 413:
      return ErrorCode.TOO_LARGE;
    case 415:
      return ErrorCode.UNSUPPORTED_TYPE;
    case 423:
      return ErrorCode.ACCOUNT_LOCKED;
    case 429:
      return ErrorCode.RATE_LIMITED;
    default:
      return status >= 500 ? ErrorCode.INTERNAL : ErrorCode.INVALID_PARAMS;
  }
}
