// Turn known client mistakes into 4xx with a short message; never leak raw
// database errors. Anything unexpected becomes a generic 500 (details in the log).
const PG_CLIENT_ERRORS = {
  '23505': [409, 'already exists'],
  '23503': [400, 'referenced record not found'],
  '23502': [400, 'missing required value'],
  '22P02': [400, 'invalid value'],
  '22007': [400, 'invalid date'],
  '22008': [400, 'invalid date'],
  '22001': [400, 'value too long'],
};

function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  let message = err.message;

  if (err.code && PG_CLIENT_ERRORS[err.code]) {
    [status, message] = PG_CLIENT_ERRORS[err.code];
  } else if (message === 'invalid phone number' || message === 'phone required') {
    status = 400;
  } else if (err.type === 'entity.too.large') {
    status = 413; message = 'request too large';
  } else if (err.type === 'entity.parse.failed') {
    status = 400; message = 'invalid JSON';
  }

  if (status >= 500) {
    console.error('[ERROR]', req.method, req.originalUrl, err);
    message = 'Internal server error';
  }
  res.status(status).json({ success: false, error: message });
}

function notFound(req, res) {
  res.status(404).json({ success: false, error: 'Not found' });
}

module.exports = { errorHandler, notFound };
