// This lib exists to demonstrate ESM imports

import { v4 } from '@lukeed/uuid/secure'

export const id = (): string => v4()
