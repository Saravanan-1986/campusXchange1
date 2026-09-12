/** Central error handler + 404. Keeps API errors JSON-shaped for the client. */
export function notFound(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error('[error]', err.message || err);
  if (err.name === 'ValidationError') {
    return res.status(422).json({ message: Object.values(err.errors).map((e) => e.message).join(', ') });
  }
  if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid id format' });
  if (err.code === 11000) {
    return res.status(409).json({ message: 'Duplicate value: ' + Object.keys(err.keyValue || {}).join(', ') });
  }
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
}
