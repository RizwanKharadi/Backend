import express from 'express';
import rateLimit from 'express-rate-limit';
import { protect, checkCompanyAccess } from '../middleware/auth.js';
import { requireActiveSubscription } from '../middleware/license.js';
import { chatWithBusiness } from '../controllers/aiController.js';

const router = express.Router();

// Extra-tight rate limit just for AI chat to control token usage
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60, // 60 questions per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false
});

router.use(protect, requireActiveSubscription, aiLimiter);

// @desc    Ask your business (NL Q&A)
// @route   POST /api/ai/chat
// @access  Private
router.post(
  '/chat',
  checkCompanyAccess,
  chatWithBusiness
);

export default router;

