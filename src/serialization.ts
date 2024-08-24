const MAX_STR_SIZE = 4096
let ID = 0

type ChunkData = [number, number, string]|[number, number, string, boolean]

export function serialize(data: any) {
  return JSON.stringify(data);
}

export function deserialize(data: string) {
  return JSON.parse(data);
}

export function chunk(data: string): ChunkData[] {
  const chunks = (data.length > MAX_STR_SIZE) ? (data.match(new RegExp(`.{1,${MAX_STR_SIZE}}`, 'g')) || []).map((match) => {return match}) : [data]
  ID++
  return chunks.map((chunk, index) => {
    if (index === (chunks.length-1)) {
      return [ID,index,chunk,true]
    }
    return [ID,index,chunk]
  })
}