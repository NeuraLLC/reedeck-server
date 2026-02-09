import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { attachOrganization } from '../middleware/organization';
import { AuthRequest } from '../types';
import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { randomUUID } from 'crypto';

const router = Router();

router.use(authenticate);
router.use(attachOrganization);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

router.post('/', upload.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const file = req.file;
    if (!file) {
      throw new AppError('No file provided', 400);
    }

    const ext = file.originalname.split('.').pop() || 'bin';
    const filePath = `${req.organizationId}/${randomUUID()}.${ext}`;

    const { error } = await supabaseAdmin.storage
      .from('ticket-attachments')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) {
      throw new AppError(`Upload failed: ${error.message}`, 500);
    }

    const { data: urlData } = supabaseAdmin.storage
      .from('ticket-attachments')
      .getPublicUrl(filePath);

    res.json({
      url: urlData.publicUrl,
      name: file.originalname,
      type: file.mimetype,
      size: file.size,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
