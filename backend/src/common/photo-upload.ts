import { BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { extname } from 'path';

export const UPLOAD_DIR = 'uploads';
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

export const photoUpload = FileInterceptor('photo', {
  storage: diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new BadRequestException('Only image files are allowed'), false);
    }
    cb(null, true);
  },
});

// removes an uploaded file when the request is rejected afterwards
export async function discardUpload(file?: Express.Multer.File) {
  if (!file) return;
  try {
    await unlink(file.path);
  } catch {
    // already gone
  }
}