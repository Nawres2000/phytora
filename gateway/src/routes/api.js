import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { catalogList } from '../utils/catalog.js';

const r = Router();
r.get('/catalog', requireAuth, (req, res) => res.json({ classes: catalogList() }));
export default r;
