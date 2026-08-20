import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { GenerationModule } from './generation/generation.module';
import { SecurityModule } from './security/security.module';
import { VisitorMiddleware } from './security/visitor.middleware';
import { TrendsModule } from './trends/trends.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    PrismaModule,
    SecurityModule,
    ProjectsModule,
    GenerationModule,
    TrendsModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(VisitorMiddleware)
      .exclude(
        { path: '{*path}', method: RequestMethod.OPTIONS },
        { path: 'health', method: RequestMethod.GET },
        { path: 'health/live', method: RequestMethod.GET },
        { path: 'health/ready', method: RequestMethod.GET },
        { path: 'auth/{*path}', method: RequestMethod.ALL },
      )
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
