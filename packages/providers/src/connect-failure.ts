import { subscribe } from "node:diagnostics_channel";

// A TLS record/protocol error can also happen after HTTP was sent. Only undici's
// connection-error event proves that the TLS handshake itself failed. Weak pins
// neither retain requests/errors nor correlate unrelated concurrent calls by URL.
const connectingErrors = new WeakSet<object>();
subscribe("undici:client:connectError", (message: unknown) => {
  const error = message && typeof message === "object" ? (message as { error?: unknown }).error : undefined;
  if (error && typeof error === "object") connectingErrors.add(error);
});

/** Only positive pre-connection evidence is safe. Resets, aborts and generic timeouts are ambiguous. */
export function connectFailureCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return;
  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") return;
  const connectCodes = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
  const tlsCodes = new Set([
    "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID",
    "ERR_SSL_WRONG_VERSION_NUMBER", "ERR_SSL_PACKET_LENGTH_TOO_LONG", "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE", "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION"]);
  const classify = (value: object, connecting = connectingErrors.has(value)): string | undefined => {
    const row = value as { code?: unknown; errors?: unknown[] };
    // Happy Eyeballs can wrap multiple failed connection attempts in AggregateError.
    if (value instanceof AggregateError) {
      const children = value.errors as unknown[];
      return children.length > 0 && children.every(child => child && typeof child === "object" && classify(child, connecting || connectingErrors.has(child)))
        ? classify(children[0] as object, connecting || connectingErrors.has(children[0] as object)) : undefined;
    }
    return typeof row.code === "string" && (connectCodes.has(row.code) || connecting && tlsCodes.has(row.code)) ? row.code : undefined;
  };
  return classify(cause);
}
