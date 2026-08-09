'use strict';

/**
 * Serve landmark white-paper PDFs from MinIO (papers/<section>/<id>.pdf).
 * Public GET so Play tiles can open in a new tab without auth headers.
 */

const express = require('express');
const { getObjectStore, normalizeKey } = require('../workspace/objectStore');

const router = express.Router();

const ALLOWED = new Set([
  'spark/rdd',
  'spark/spark-sql',
  'spark/dstreams',
  'spark/structured-streaming',
  'spark/mapreduce',
]);

router.get('/:sectionId/:paperId', async (req, res, next) => {
  try {
    const sectionId = String(req.params.sectionId || '').trim();
    const paperId = String(req.params.paperId || '').trim().replace(/\.pdf$/i, '');
    const slug = `${sectionId}/${paperId}`;
    if (!ALLOWED.has(slug)) {
      res.status(404).json({ error: 'paper not found' });
      return;
    }

    const key = normalizeKey(`papers/${slug}.pdf`);
    const store = getObjectStore();
    const buf = await store.getObject(key);
    if (!buf) {
      res.status(404).json({ error: 'paper missing in object store' });
      return;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Content-Disposition', `inline; filename="${paperId}.pdf"`);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
