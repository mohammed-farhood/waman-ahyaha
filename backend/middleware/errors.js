function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const message = err.expose !== false ? err.message : 'Internal server error';
  if (status >= 500) console.error('[ERROR]', err);
  res.status(status).json({ success: false, error: message });
}

function notFound(req, res) {
  res.status(404).json({ success: false, error: 'Not found' });
}

module.exports = { errorHandler, notFound };
