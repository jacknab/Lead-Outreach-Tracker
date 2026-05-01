import * as net from "net";

const AMI_HOST = new URL(process.env.FREEPBX_URL || "http://localhost").hostname;
const AMI_PORT = 5038;
const AMI_USER = process.env.ASTERISK_AMI_USER || "";
const AMI_SECRET = process.env.ASTERISK_AMI_SECRET || "";

interface AmiResponse {
  Response?: string;
  Message?: string;
  ActionID?: string;
  [key: string]: string | undefined;
}

function parseAmiMessage(raw: string): AmiResponse[] {
  return raw
    .split("\r\n\r\n")
    .map((block) => {
      const obj: AmiResponse = {};
      block.split("\r\n").forEach((line) => {
        const idx = line.indexOf(": ");
        if (idx !== -1) {
          obj[line.slice(0, idx)] = line.slice(idx + 2);
        }
      });
      return obj;
    })
    .filter((o) => Object.keys(o).length > 0);
}

export function amiOriginate(params: {
  extension: string;
  phoneNumber: string;
  callerId?: string;
  actionId?: string;
}): Promise<{ success: boolean; channel?: string; message?: string }> {
  return new Promise((resolve) => {
    const actionId = params.actionId || `dialer-${Date.now()}`;
    const client = net.connect(AMI_PORT, AMI_HOST);
    let buf = "";
    let loggedIn = false;
    let done = false;

    const finish = (result: { success: boolean; channel?: string; message?: string }) => {
      if (done) return;
      done = true;
      client.destroy();
      resolve(result);
    };

    client.setTimeout(15000, () =>
      finish({ success: false, message: "AMI connection timed out" })
    );

    client.on("error", (e) =>
      finish({ success: false, message: `AMI error: ${e.message}` })
    );

    client.on("data", (chunk) => {
      buf += chunk.toString();
      const messages = parseAmiMessage(buf);

      for (const msg of messages) {
        if (!loggedIn && msg.Response === "Success" && msg.Message === "Authentication accepted") {
          loggedIn = true;

          const cleanPhone = params.phoneNumber.replace(/\D/g, "");

          const originate = [
            "Action: Originate",
            `ActionID: ${actionId}`,
            `Channel: PJSIP/${params.extension}`,
            `Context: from-internal`,
            `Exten: ${cleanPhone}`,
            `Priority: 1`,
            `Timeout: 30000`,
            `CallerID: Dialer <${params.extension}>`,
            `Async: true`,
            "",
            "",
          ].join("\r\n");

          client.write(originate);
        }

        if (msg.ActionID === actionId) {
          if (msg.Response === "Success") {
            finish({ success: true, message: msg.Message });
          } else if (msg.Response === "Error") {
            finish({ success: false, message: msg.Message || "Originate failed" });
          }
        }
      }
    });

    client.on("connect", () => {
      const login = [
        "Action: Login",
        `Username: ${AMI_USER}`,
        `Secret: ${AMI_SECRET}`,
        "",
        "",
      ].join("\r\n");
      client.write(login);
    });
  });
}
