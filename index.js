import crypto from 'node:crypto'
import { exec } from 'node:child_process'
import fs from 'node:fs'
import fetch from 'node-fetch'
import createFastify from 'fastify'

const app = createFastify({ logger: true })

await app.register(import('fastify-raw-body'), {
  field: 'rawBody', // change the default request.rawBody property name
  global: false, // add the rawBody to every request. **Default true**
  encoding: 'utf8', // set it to false to set rawBody as a Buffer **Default utf8**
  runFirst: true, // get the body before any preParsing hook change/uncompress it. **Default false**
  routes: [], // array of routes, **`global`** will be ignored, wildcard routes not supported
})

const signatureHeader = 'ordinals-sig'

const checkWebhookIsSafe = (signature, rawBody) => {
  const signatureBuffer = Buffer.from(signature)
  const signatureHashAlg = 'sha256'
  const signaturePrefix = 'sha256='
  const hmac = crypto.createHmac(signatureHashAlg, ORDINALS_SECRET)
  const hmacedRawBody = hmac.update(rawBody).digest('hex')
  const digest = Buffer.from(signaturePrefix + hmacedRawBody, 'utf8')

  return (
    signatureBuffer.length === digest.length &&
    crypto.timingSafeEqual(digest, signatureBuffer)
  )
}

const execPromise = (command) =>
  new Promise((resolve, reject) => {
    exec(command, (err, stdout, stderr) => {
      if (err) {
        //some err occurred
        console.error(err)
        reject()
      } else {
        // the *entire* stdout and stderr (buffered)
        console.log(`stdout: ${stdout}`)
        console.log(`stderr: ${stderr}`)
        resolve({ stdout, stderr })
      }
    })
    if (err) {
      reject()
    } else {
      resolve()
    }
  })

const execComand = async ({ filePath, feeRate, address }) => {
  try {
    const result0 = await execPromise(
      `~/bin/ord --wallet ilyaFriends wallet inscribe --fee-rate ${feeRate} ${filePath}`
    )
    const result1 = await execPromise(
      `~/bin/ord --wallet ilyaFriends wallet send --fee-rate ${feeRate} ${address}`
    )
    console.log('results chain', result0, result1)
  } catch (err) {
    console.error('Comand error', err)
  }
}

const download = (uri, filename) => {
  return new Promise((resolve, reject) => {
    fetch(uri).then((response) => {
      response.body.pipe(fs.createWriteStream(filename)).on('close', (err) => {
        if (err) {
          reject()
        } else {
          console.log('File downloaded', uri, filename)
          resolve()
        }
      })
    })
  })
}

app.route({
  method: 'POST',
  url: '/webhook',
  config: {
    // add the rawBody to this route. if false, rawBody will be disabled when global is true
    rawBody: true,
  },
  schema: {
    body: {
      type: 'object',
      properties: {
        fileUrl: { type: 'string' },
        feeRate: { type: 'number' },
        address: { type: 'string' },
      },
    },
    // the response needs to be an object with an `hello` property of type 'string'
    response: {
      200: {
        type: 'object',
        properties: {
          result: { type: 'string' },
        },
      },
    },
  },
  // this function is executed for every request before the handler is executed
  preHandler: async (request, reply, done) => {
    const signature = request.headers[signatureHeader]
    if (signature && checkWebhookIsSafe(signature, request.rawBody)) {
      console.log('Signature is valid')

      return
    }

    console.log('Signature is invalid')
    reply.code(401).send()
    return new Error('nope')
  },
  handler: async (request, reply) => {
    try {
      const extension = request.body.fileUrl.split('.').at(-1)
      const filePath = `./image-folder/${crypto.randomUUID()}.${extension}`
      await download(request.body.fileUrl, filePath)
      await execComand({
        filePath,
        feeRate: request.body.feeRate,
        address: request.body.address,
      })
      return reply.code(200).send({ result: 'OK' })
    } catch (err) {
      console.error(err)
      return reply.code(500).send({ result: 'Error' })
    }
  },
})

const start = async () => {
  try {
    await app.listen({ port: 3010 })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}
start()
