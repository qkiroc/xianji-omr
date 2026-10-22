// Lazy SDK loading keeps startup/health independent from OSS metadata access.
// No default credential chain: only explicitly selected ECS RAM Role / STS / AK.
export function ossStorage(o: any) {
  let provider: any;
  async function client() {
    const { default: OSS } = await import("ali-oss");
    let auth;
    if (o.authMode === "ram") {
      if (!provider) {
        const { default: C } = await import("@alicloud/credentials");
        provider = new (C as any).default({
          type: "ecs_ram_role",
          disableIMDSv1: true,
          ...(o.roleName ? { roleName: o.roleName } : {}),
        });
      }
      const c = await provider.getCredential();
      auth = {
        accessKeyId: c.accessKeyId,
        accessKeySecret: c.accessKeySecret,
        stsToken: c.securityToken,
      };
    } else
      auth = {
        accessKeyId: o.accessKeyId,
        accessKeySecret: o.accessKeySecret,
        ...(o.securityToken ? { stsToken: o.securityToken } : {}),
      };
    return new OSS({
      region: o.region,
      endpoint: o.endpoint,
      bucket: o.bucket,
      timeout: 20000,
      secure: true,
      ...auth,
    });
  }
  return {
    async put(key: any, data: any, mime: any) {
      await (
        await client()
      ).put(key, data, { headers: { "Content-Type": mime } });
    },
    async putStream(key: any, stream: any, mime: any) {
      await (
        await client()
      ).putStream(key, stream, { headers: { "Content-Type": mime } } as any);
    },
    async getStream(key: any) {
      return (await (await client()).getStream(key)).stream;
    },
    async get(key: any) {
      return (await (await client()).get(key)).content;
    },
    async delete(key: any) {
      await (await client()).delete(key);
    },
  };
}
