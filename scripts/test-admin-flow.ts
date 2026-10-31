async function testAdminLoginAndPages() {
  console.log("1. Logging in as ops1...");
  const loginRes = await fetch("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginId: "ops1", password: "AdminPassword123!" }),
  });
  console.log("Login status:", loginRes.status);
  const setCookie = loginRes.headers.get("set-cookie") || "";
  const atMatch = setCookie.match(/at=([^;]+)/);
  const atCookie = atMatch ? `at=${atMatch[1]}` : "";

  console.log("\n2. Getting /admin...");
  const adminRes = await fetch("http://localhost:3000/admin", {
    headers: { cookie: atCookie },
  });
  console.log("/admin status:", adminRes.status);

  console.log("\n3. Getting /admin/daily-reports...");
  const drRes = await fetch("http://localhost:3000/admin/daily-reports", {
    headers: { cookie: atCookie },
  });
  console.log("/admin/daily-reports status:", drRes.status);

  console.log("\n4. Getting /admin/compliance...");
  const compRes = await fetch("http://localhost:3000/admin/compliance", {
    headers: { cookie: atCookie },
  });
  console.log("/admin/compliance status:", compRes.status);
}

testAdminLoginAndPages().catch(console.error);

