import { peopleArrived, peopleNotArrived, delay } from '../mock/people'

export async function fetchArrivedPeople() {
  await delay(300)
  return structuredClone(peopleArrived)
}

export async function fetchNotArrivedPeople() {
  await delay(300)
  return structuredClone(peopleNotArrived)
}

