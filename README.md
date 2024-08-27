# MCBE-IPC 📡

An IPC[^1] system for MCBE Script API projects

[^1]: Inter-Pack Communication

## Dependencies

| Name | Version |
|---|---|
| `@minecraft/server` | Any |

## Installation
**JavaScript**
1. Download `ipc.js` and `ipc.d.ts` from the latest [release](https://github.com/OmniacDev/MCBE-IPC/releases/latest)
2. Copy the files into your project

**TypeScript**
1. Download `ipc.ts` from the latest [release](https://github.com/OmniacDev/MCBE-IPC/releases/latest)
2. Copy file into your project

##  Usage

### Sending & Receiving

`IPC.send()` and `IPC.on()` can be used to send messages or data between packs. 

_Pack 1_
```js
import IPC from 'ipc.js'

IPC.on('message_channel', (args) => {
  console.log(`Message: ${args}`)
})

IPC.on('data_channel', (args) => {
  console.log(`Data: ${args.example_bool}, ${args.example_number}`)
})
```
_Pack 2_
```js
import IPC from 'ipc.js'

IPC.send('message_channel', 'Example Message')

IPC.send('data_channel', { example_number: 100, example_bool: true })
```
_Console Output_
```
Message: Example Message
Data: true, 100
```

### Requesting & Serving

`IPC.invoke()` and `IPC.handle()` can be used to request and serve data between packs.

_Pack 1_
```js
import IPC from 'ipc.js'

IPC.handle('request_channel', (args) => {
  switch (args) {
    case 'status': 
      return 'inactive'
    case 'size': 
      return 100
  }
})
```
_Pack 2_
```js
import IPC from 'ipc.js'

IPC.invoke('request_channel', 'status').then(result => {
  console.log(`Status: ${result}`)
})

IPC.invoke('request_channel', 'size').then(result => {
  console.log(`Size: ${result}`)
})
```
_Console Output_
```
Status: inactive
Size: 100
```



