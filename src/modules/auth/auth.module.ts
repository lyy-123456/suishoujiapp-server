import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { env } from '../../config/env';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { LoginThrottleService } from './login-throttle.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Module({
  imports: [
    // 只在这里配置密钥；有效期在签发时按 env 传入（access token 15 分钟）
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: env().JWT_SECRET,
        signOptions: { algorithm: 'HS256' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, LoginThrottleService, AuthGuard],
  exports: [AuthService, PasswordService, TokenService, AuthGuard, LoginThrottleService],
})
export class AuthModule {}
