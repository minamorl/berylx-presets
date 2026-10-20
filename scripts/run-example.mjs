import { result } from '../.test-build/examples/predicates.js';

if (result.ok) console.log(JSON.stringify(result.value, null, 2));
else {
  console.error(result.result.error.toObject());
  process.exitCode = 1;
}
