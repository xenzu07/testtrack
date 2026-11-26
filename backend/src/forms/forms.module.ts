import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JWT_ALGORITHM, jwtSecret } from '../auth/session';
import { FormsController, FormsSharedPdfController } from './forms.controller';
import { FormsService } from './forms.service';

@Module({
  imports: [
    // used only for the 5-minute PDF links (a separate "purpose" claim, so
    // such a token can never be used to sign in)
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: jwtSecret(config),
        signOptions: { algorithm: JWT_ALGORITHM },
        verifyOptions: { algorithms: [JWT_ALGORITHM] },
      }),
    }),
  ],
  controllers: [FormsController, FormsSharedPdfController],
  providers: [FormsService],
})
export class FormsModule {}
