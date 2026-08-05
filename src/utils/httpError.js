class HttpError extends Error {
  constructor(statusCode, message, code = 'HTTP_ERROR', details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
module.exports = HttpError;
