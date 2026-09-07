import { connect, createServer } from 'node:net'

const server = createServer(socket => {
  const upstream = connect({ host: '127.0.0.1', port: Number(process.env.DSH_PORT ?? 3080) })
  socket.on('error', () => upstream.destroy())
  upstream.on('error', () => socket.destroy())
  socket.on('close', () => upstream.destroy())
  upstream.on('close', () => socket.destroy())
  socket.pipe(upstream).pipe(socket)
})
server.listen(Number(process.env.DSH_PROXY_PORT ?? 3081), '0.0.0.0')
