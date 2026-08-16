export const OPCODES = {
  INPUT: 0x01,
  RESIZE: 0x02,
  CLOSE: 0x03,
  OUTPUT: 0x04,
  EXIT: 0x05,
  ERROR: 0x06,
  INIT_ACK: 0x07,
  TITLE: 0x08,
  REPLAY_COMPLETE: 0x09,
} as const;

export type Opcode = typeof OPCODES[keyof typeof OPCODES];

export function encodeFrame(opcode: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(1 + payload.length);
  frame[0] = opcode;
  frame.set(payload, 1);
  return frame;
}

export function decodeFrame(buffer: Uint8Array): { opcode: number; payload: Uint8Array } {
  if (buffer.length < 1) {
    throw new Error('Invalid frame: empty buffer');
  }
  const opcode = buffer[0];
  const payload = buffer.slice(1);
  return { opcode, payload };
}
