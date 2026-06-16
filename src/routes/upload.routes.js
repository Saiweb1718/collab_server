import { Router } from 'express';
import multer from 'multer';
import { Authorize } from '../middlewares/auth.middlewares.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uploadFile, isStorageConfigured } from '../utils/storage.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

const router = Router();
router.use(Authorize);

router.get('/status', (_req, res) =>
  res.json(new ApiResponse(200, { configured: isStorageConfigured() }, 'OK'))
);

router.post(
  '/',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'No file provided');
    const folder = req.query.folder === 'avatars' ? 'avatars' : 'chat';
    const result = await uploadFile(req.file, folder);
    return res.status(201).json(new ApiResponse(201, result, 'Uploaded'));
  })
);

export default router;
