const { ZodError } = require('zod');

function notFound(req, _res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;
  error.code = 'NOT_FOUND';
  next(error);
}

function errorHandler(error, _req, res, _next) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request data.', details: error.issues }
    });
  }

  if (error.code === '23505') {
    return res.status(409).json({
      success: false,
      error: { code: 'DUPLICATE_VALUE', message: 'A unique value already exists.' }
    });
  }

  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) console.error(error);

  res.status(statusCode).json({
    success: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: statusCode >= 500 ? 'Internal server error.' : error.message,
      ...(error.details ? { details: error.details } : {})
    }
  });
}

module.exports = { notFound, errorHandler };
