import { Module, Global } from '@nestjs/common';
import { ExternalDbController } from './external-db.controller';
import { ExternalDbService } from './external-db.service';
import { EncryptionService } from '../../common/encryption.service';

@Global()
@Module({
  controllers: [ExternalDbController],
  providers: [ExternalDbService, EncryptionService],
  exports: [ExternalDbService, EncryptionService],
})
export class ExternalDbModule { }
