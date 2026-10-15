const crypto = require("crypto");

/* AWS Signature Version 4 for a GET with no body (enough for read-only S3 / S3-compatible listing). Pure. */
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data, "utf8").digest();
const sha256 = (data) => crypto.createHash("sha256").update(data, "utf8").digest("hex");
const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

function signGet({ host, path = "/", query = {}, region, service = "s3", accessKey, secretKey, sessionToken = "", date = new Date(), contentHashHeader = true }) {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const canonicalQuery = Object.keys(query).sort().map((k) => encode(k) + "=" + encode(query[k])).join("&");
  const headers = { host, "x-amz-date": amzDate };
  if (contentHashHeader) headers["x-amz-content-sha256"] = sha256(""); // S3 requires it; the generic AWS test vector does not send it
  if (sessionToken) headers["x-amz-security-token"] = sessionToken;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => n + ":" + String(headers[n]).trim() + "\n").join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = ["GET", path, canonicalQuery, canonicalHeaders, signedHeaders, sha256("")].join("\n");
  const scope = [day, region, service, "aws4_request"].join("/");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac("AWS4" + secretKey, day), region), service), "aws4_request");
  const signature = crypto.createHmac("sha256", signingKey).update(toSign, "utf8").digest("hex");
  return {
    query: canonicalQuery,
    headers: { ...headers, Authorization: "AWS4-HMAC-SHA256 Credential=" + accessKey + "/" + scope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature }
  };
}

module.exports = { signGet, sha256 };
