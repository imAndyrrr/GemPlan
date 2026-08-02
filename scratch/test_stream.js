async function test() {
  const url = 'https://gemplan.newrst.qzz.io/imandyrrr/v1/chat/completions';
  const apiKey = process.env.GEMPLAN_API_KEY;
  if (!apiKey) throw new Error('Set GEMPLAN_API_KEY before running this test');
  
  const payload = {
    model: 'gemini-2.5-flash',
    messages: [
      { role: 'user', content: 'hello, say test' }
    ],
    stream: true
  };

  console.log("Sending request to:", url);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    console.log("Status:", res.status);

    if (!res.ok) {
      const text = await res.text();
      console.error("Error response:", text);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) {
          console.log("LINE ->", buffer);
        }
        console.log("STREAM DONE");
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (line.trim()) {
          console.log("LINE ->", line);
        }
      }
    }
  } catch (err) {
    console.error("Fetch error:", err);
  }
}

test();
