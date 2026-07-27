import { updateJsonFile } from "../.pi/extensions/tokenomy/lib/storage.ts";

const [path, iterationsText] = process.argv.slice(2);
const iterations = Number(iterationsText);
for (let index = 0; index < iterations; index += 1) {
  updateJsonFile(path, { count: 0 }, (current) => ({
    count:
      (current &&
      typeof current === "object" &&
      typeof current.count === "number"
        ? current.count
        : 0) + 1,
  }));
}
