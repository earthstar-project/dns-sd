import { delay } from "https://deno.land/std@0.177.0/async/delay.ts";
import { MulticastInterface } from "../src/mdns/multicast_interface.ts";
import { TestMulticastDriver } from "./test_multicast_driver.ts";
import { browse, Service } from "../src/dns_sd/browse.ts";
import { advertise } from "../src/dns_sd/advertise.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

// Integration test: if something is advertised, it should be found by the browser.
Deno.test({
  name: "Can browse and advertise",
  fn: async () => {
    const browserDriver = new TestMulticastDriver("0.0.0.0", (msg) => {
      adv1Driver1.sendInboundMessage(msg, "0.0.0.0");
      adv1Driver2.sendInboundMessage(msg, "0.0.0.0");
    });

    const adv1Driver1 = new TestMulticastDriver("1.1.1.1", (msg) => {
      browserDriver.sendInboundMessage(msg, "1.1.1.1");
      adv1Driver2.sendInboundMessage(msg, "1.1.1.1");
    });

    const adv1Driver2 = new TestMulticastDriver("2.2.2.2", (msg) => {
      browserDriver.sendInboundMessage(msg, "2.2.2.2");
      adv1Driver1.sendInboundMessage(msg, "2.2.2.2");
    });

    const browserInt = new MulticastInterface(browserDriver);
    const adv1Int = new MulticastInterface(adv1Driver1);
    const adv2Int = new MulticastInterface(adv1Driver2);

    const abortController = new AbortController();

    const services: Service[] = [];

    (async () => {
      for await (
        const service of browse({
          multicastInterface: browserInt,
          service: {
            protocol: "tcp",
            subtypes: ["test"],
            type: "http",
          },
          signal: abortController.signal,
        })
      ) {
        services.push(service);
      }
    })();

    advertise({
      multicastInterface: adv1Int,
      signal: abortController.signal,
      service: {
        name: "Happy",
        host: "1.1.1.1",
        port: 5353,
        protocol: "tcp",
        type: "http",
        subtypes: ["test"],
        txt: {
          isTesting: true,
        },
      },
    }).catch(() => {
      // Happens on abort.
    });

    advertise({
      multicastInterface: adv2Int,
      signal: abortController.signal,
      service: {
        name: "Smiley",
        host: "2.2.2.2",
        port: 5353,
        protocol: "tcp",
        type: "http",
        subtypes: ["test"],
        txt: {
          isTesting: true,
        },
      },
    }).catch(() => {
      // Happens on abort.
    });

    await delay(1000);

    const happyService = services.find((service) => {
      return service.name === "Happy";
    });

    const smileyService = services.find((service) => {
      return service.name === "Smiley";
    });

    assert(happyService);
    assert(smileyService);

    assertEquals(happyService, {
      host: "1.1.1.1",
      isActive: true,
      name: "Happy",
      port: 5353,
      protocol: "tcp",
      subtypes: ["test"],
      txt: {
        isTesting: true,
      },
      type: "http",
    });

    assertEquals(smileyService, {
      host: "2.2.2.2",
      isActive: true,
      name: "Smiley",
      port: 5353,
      protocol: "tcp",
      subtypes: ["test"],
      txt: {
        isTesting: true,
      },
      type: "http",
    });

    abortController.abort();
  },
});

// If two things advertise at the same time, conflicts should be resolved, and the browser should get two results...
Deno.test({
  name: "Advertisements resolve naming conflicts",
  fn: async () => {
    const browserDriver = new TestMulticastDriver("0.0.0.0", (msg) => {
      adv1Driver1.sendInboundMessage(msg, "0.0.0.0");
      adv1Driver2.sendInboundMessage(msg, "0.0.0.0");
    });

    const adv1Driver1 = new TestMulticastDriver("1.1.1.1", (msg) => {
      browserDriver.sendInboundMessage(msg, "1.1.1.1");
      adv1Driver2.sendInboundMessage(msg, "1.1.1.1");
    });

    const adv1Driver2 = new TestMulticastDriver("2.2.2.2", (msg) => {
      browserDriver.sendInboundMessage(msg, "2.2.2.2");
      adv1Driver1.sendInboundMessage(msg, "2.2.2.2");
    });

    const browserInt = new MulticastInterface(browserDriver);
    const adv1Int = new MulticastInterface(adv1Driver1);
    const adv2Int = new MulticastInterface(adv1Driver2);

    const abortController = new AbortController();

    const services: Service[] = [];

    (async () => {
      for await (
        const service of browse({
          multicastInterface: browserInt,
          service: {
            protocol: "tcp",
            subtypes: ["test"],
            type: "http",
          },
          signal: abortController.signal,
        })
      ) {
        services.push(service);
      }
    })();

    advertise({
      multicastInterface: adv1Int,
      signal: abortController.signal,
      service: {
        name: "Best and Only",
        host: "1.1.1.1",
        port: 5353,
        protocol: "tcp",
        type: "http",
        subtypes: ["test"],
        txt: {
          isTesting: true,
        },
      },
    }).catch(() => {
      // Happens on abort.
    });

    advertise({
      multicastInterface: adv2Int,
      signal: abortController.signal,
      service: {
        name: "Best and Only",
        host: "2.2.2.2",
        port: 5353,
        protocol: "tcp",
        type: "http",
        subtypes: ["test"],
        txt: {
          isTesting: true,
        },
      },
    }).catch(() => {
      // Happens on abort.
    });

    await delay(2500);

    const best1 = services.find((service) => {
      return service.name === "Best and Only";
    });

    const best2 = services.find((service) => {
      return service.name === "Best and Only (2)";
    });

    assert(best1);
    assert(best2);

    abortController.abort();
  },
});

// When something goodbyes or expires, the browser should say how the service has gone down.
