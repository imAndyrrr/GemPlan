async function test() {
  const url = 'https://gemplan.newrst.qzz.io/imandyrrr/v1beta/models/gemini-2.5-flash:streamGenerateContent';
  const apiKey = 'YOUR_GEMPLAN_API_KEY';
  
  const payload = {
    contents: [
      { role: 'user', parts: [{ text: 'hello, say test' }] }
    ]
  };

  console.log("Sending request to Gemini endpoint:", url);
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
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log("STREAM DONE");
        break;
      }
      console.log("CHUNK DATA:\n", decoder.decode(value));
    }
  } catch (err) {
    console.error("Fetch error:", err);
  }
}

test();
