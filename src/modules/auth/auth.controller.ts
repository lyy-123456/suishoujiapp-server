import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { zodBody } from '../../common/zod-validation.pipe';
import {
  changePasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  sessionIdParamSchema,
  type ChangePasswordInput,
  type LoginInput,
  type LogoutInput,
  type RefreshInput,
  type RegisterInput,
} from './auth.dto';
import { AuthGuard } from './auth.guard';
import { AuthService, type AuthContext, type AuthUser } from './auth.service';
import { CurrentUser, RequestCtx } from './current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 注册（默认需要邀请码，见 ALLOW_REGISTER / INVITE_CODE） */
  @Post('register')
  register(@Body(zodBody(registerSchema)) dto: RegisterInput, @RequestCtx() ctx: AuthContext) {
    return this.auth.register(dto, ctx);
  }

  /** 登录 */
  @Post('login')
  @HttpCode(200)
  login(@Body(zodBody(loginSchema)) dto: LoginInput, @RequestCtx() ctx: AuthContext) {
    return this.auth.login(dto, ctx);
  }

  /** 用 refresh token 换新令牌（单次使用 + 轮换 + 复用检测） */
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(zodBody(refreshSchema)) dto: RefreshInput, @RequestCtx() ctx: AuthContext) {
    return this.auth.refresh(dto.refreshToken, ctx);
  }

  /** 登出（可只退当前设备，或退所有设备） */
  @Post('logout')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  logout(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(logoutSchema)) dto: LogoutInput,
    @RequestCtx() ctx: AuthContext,
  ) {
    return this.auth.logout(user, dto, ctx);
  }

  /** 修改密码：改完旧令牌全部失效，并给当前设备发一套新令牌 */
  @Post('password')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(changePasswordSchema)) dto: ChangePasswordInput,
    @RequestCtx() ctx: AuthContext,
  ) {
    return this.auth.changePassword(user, dto, ctx);
  }

  /** 当前用户信息 */
  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  /** 已登录设备列表 */
  @Get('sessions')
  @UseGuards(AuthGuard)
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user);
  }

  /** 踢掉某个设备 */
  @Delete('sessions/:id')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async revokeSession(
    @CurrentUser() user: AuthUser,
    @Param(zodBody(sessionIdParamSchema)) params: { id: string },
    @RequestCtx() ctx: AuthContext,
  ) {
    await this.auth.revokeSession(user, params.id, ctx);
    return { revoked: true };
  }
}
