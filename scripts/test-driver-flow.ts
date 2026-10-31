async function testDriverLoginAndPages() {
  // 1. POST /api/auth/login
  console.log("1. Logging in as adnan11...");
  const loginRes = await fetch("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginId: "adnan11", password: "DriverPassword123!" }),
  });
  console.log("Login status:", loginRes.status);
  const setCookie = loginRes.headers.get("set-cookie") || "";
  console.log("Cookie received:", setCookie.slice(0, 50) + "...");

  // Extract at cookie
  const atMatch = setCookie.match(/at=([^;]+)/);
  const atCookie = atMatch ? `at=${atMatch[1]}` : "";

  // 2. GET /
  console.log("\n2. Getting / (Home page)...");
  const homeRes = await fetch("http://localhost:3000/", {
    headers: { cookie: atCookie },
  });
  console.log("Home page status:", homeRes.status);

  // 3. GET /api/driver/dashboard
  console.log("\n3. Getting /api/driver/dashboard...");
  const dashRes = await fetch("http://localhost:3000/api/driver/dashboard", {
    headers: { cookie: atCookie },
  });
  console.log("Dashboard API status:", dashRes.status);
  const dashData = await dashRes.json();
  console.log("Dashboard data:", JSON.stringify(dashData, null, 2));

  // 4. GET /api/me
  console.log("\n4. Getting /api/me...");
  const meRes = await fetch("http://localhost:3000/api/me", {
    headers: { cookie: atCookie },
  });
  console.log("/api/me status:", meRes.status);
  console.log("/api/me data:", await meRes.json());
}

testDriverLoginAndPages().catch(console.error);

