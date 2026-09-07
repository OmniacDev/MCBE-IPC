# MCBE-IPC 📡

An IPC[^1] system for MCBE Script API projects

## 🔗 Dependencies

| Package             | Version |
|---------------------|---------|
| `@minecraft/server` | 1.18.0  |

## 🚀 Installation

### 📦 NPM

```bash
npm install mcbe-ipc
```

### 🛠 Manual

1. Download the applicable file(s) for your language from the
   latest [release](https://github.com/OmniacDev/MCBE-IPC/releases/latest):
    - For **JavaScript**: `ipc.js` and `ipc.d.ts`
    - For **TypeScript**: `ipc.ts`
2. Add the downloaded file(s) to your project directory.

## 📚 Documentation

Full documentation lives in [`docs/`](./docs/README.md):

- [Getting Started](./docs/getting-started.md)
- [Architecture](./docs/architecture.md)
- [IPC API Reference](./docs/ipc-api.md)
- [Serialization](./docs/serialization.md)
- [Advanced Serializers](./docs/advanced-serializers.md)
- [Wire Protocol](./docs/wire-protocol.md)
- [FAQ & Troubleshooting](./docs/faq-troubleshooting.md)
- [Development](./docs/development.md)
- [Glossary](./docs/glossary.md)

The wire format itself is also formally specified as its own RFC:
[MCBE-IPC Packet Standard (MIPS)](https://gist.github.com/OmniacDev/ecd6f61ffd8d0ed6be1b7cf6ecea9145).

[^1]: Inter-Pack Communication
