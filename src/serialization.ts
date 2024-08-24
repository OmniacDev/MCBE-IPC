const MAX_STR_SIZE = 2048
let ID = 0

type ChunkData = [number, number, string] | [number, number, string, boolean]

export function serialize(data: any): string[] {
  return chunk(JSON.stringify(data)).map(data_chunk => {
    return JSON.stringify(data_chunk)
  })
}

export function deserialize(chunks: string[]) {
  const data = new Map<number, string[]>()
  chunks.map(str_chunk => {
    const chunk_data = JSON.parse(str_chunk) as ChunkData
    const map_data = data.get(chunk_data[0])
    if (map_data !== undefined) {
      map_data[chunk_data[1]] = chunk_data[2]
    }
  })

  return Array.from(data.values()).map(data_arr => {
    data_arr.join('')
  })
}

export function chunk(data: string): ChunkData[] {
  const chunks =
    data.length > MAX_STR_SIZE
      ? (data.match(new RegExp(`.{1,${MAX_STR_SIZE}}`, 'g')) || []).map(match => {
          return match
        })
      : [data]
  ID++
  return chunks.map((chunk, index) => {
    if (index === chunks.length - 1) {
      return [ID, index, chunk, true]
    }
    return [ID, index, chunk]
  })
}
