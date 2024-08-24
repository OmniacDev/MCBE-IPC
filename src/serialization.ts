export function serialize(data: any) {
  return JSON.stringify(data);
}

export function deserialize(data: string) {
  return JSON.parse(data);
}