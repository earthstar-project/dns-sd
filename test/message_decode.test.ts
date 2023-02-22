import { walk } from "https://deno.land/std@0.177.0/fs/mod.ts";
import { decodeMessage } from "../src/decode/message_decode.ts";
import { assertSnapshot } from "https://deno.land/std@0.177.0/testing/snapshot.ts";
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";

Deno.test("Decode message", async (test) => {
  for await (const entry of walk("./test/packets")) {
    await test.step(entry.name, async () => {
      if (entry.isFile) {
        const packet = await Deno.readFile(entry.path);

        const decoded = decodeMessage(packet);

        assertSnapshot(test, decoded, entry.name);

        assertEquals(decoded.header.QDCOUNT, decoded.question.length);
        assertEquals(decoded.header.ANCOUNT, decoded.answer.length);
        assertEquals(decoded.header.NSCOUNT, decoded.authority.length);
        assertEquals(decoded.header.ARCOUNT, decoded.additional.length);
      }
    });
  }
});
