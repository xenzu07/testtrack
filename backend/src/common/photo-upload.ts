import { BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ALLOWED_PHOTO_MIME } from '../storage/image-sniff';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

// Keeps the upload in memory (nothing is written to the server's disk);
// the service checks the actual bytes and sends them to Supabase Storage.
export const photoUpload = FileInterceptor('photo', {
  storage: memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 20, fieldSize: 64 * 1024 },
  fileFilter: (_req, file, cb) => {
    // early, friendly rejection; the real check is on the file's bytes
    const declared = file.mimetype.toLowerCase();
    if (!ALLOWED_PHOTO_MIME.has(declared) && declared !== 'application/octet-stream') {
      return cb(new BadRequestException('Only JPEG, PNG or WebP photos are allowed'), false);
    }
    cb(null, true);
  },
});
