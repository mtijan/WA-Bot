export function sendError(res, statusCode, errorCode, message, details = undefined) {
  return res.status(statusCode).json({
    status: 'error',
    error_code: errorCode,
    message,
    ...(details ? { details } : {})
  });
}

export function sendSuccess(res, data = undefined, statusCode = 200, extra = {}) {
  return res.status(statusCode).json({
    status: 'success',
    ...(data !== undefined ? { data } : {}),
    ...extra
  });
}
