import { expect } from 'chai';
import { default as IORedis } from 'ioredis';
import { beforeEach, describe, it } from 'mocha';
import { v4 } from 'uuid';
import { Queue, Worker, Job } from '../src/classes';
import { removeAllQueueData } from '../src/utils';

const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

describe('bulk jobs', () => {
  let queue: Queue;
  let queueName: string;
  const connection = { host: 'localhost' };

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
  });

  afterEach(async function () {
    await queue.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  it('should process jobs', async () => {
    const name = 'test';
    let processor;
    const processing = new Promise<void>(
      resolve =>
        (processor = async (job: Job) => {
          if (job.data.idx === 0) {
            expect(job.data.foo).to.be.equal('bar');
          } else {
            expect(job.data.idx).to.be.equal(1);
            expect(job.data.foo).to.be.equal('baz');
            resolve();
          }
        }),
    );
    const worker = new Worker(queueName, processor, { connection, prefix });
    await worker.waitUntilReady();

    const jobs = await queue.addBulk([
      { name, data: { idx: 0, foo: 'bar' } },
      { name, data: { idx: 1, foo: 'baz' } },
    ]);
    expect(jobs).to.have.length(2);

    expect(jobs[0].id).to.be.ok;
    expect(jobs[0].data.foo).to.be.eql('bar');
    expect(jobs[1].id).to.be.ok;
    expect(jobs[1].data.foo).to.be.eql('baz');

    await processing;
    await worker.close();
  });

  it('should allow to pass parent option', async () => {
    const name = 'test';
    const parentQueueName = `parent-queue-${v4()}`;
    const parentQueue = new Queue(parentQueueName, { connection, prefix });

    const parentWorker = new Worker(parentQueueName, null, {
      connection,
      prefix,
    });
    const childrenWorker = new Worker(queueName, null, { connection, prefix });
    await parentWorker.waitUntilReady();
    await childrenWorker.waitUntilReady();

    const parent = await parentQueue.add('parent', { some: 'data' });
    const jobs = await queue.addBulk([
      {
        name,
        data: { idx: 0, foo: 'bar' },
        opts: {
          parent: {
            id: parent.id,
            queue: `${prefix}:${parentQueueName}`,
          },
        },
      },
      {
        name,
        data: { idx: 1, foo: 'baz' },
        opts: {
          parent: {
            id: parent.id,
            queue: `${prefix}:${parentQueueName}`,
          },
        },
      },
    ]);
    expect(jobs).to.have.length(2);

    expect(jobs[0].id).to.be.ok;
    expect(jobs[0].data.foo).to.be.eql('bar');
    expect(jobs[1].id).to.be.ok;
    expect(jobs[1].data.foo).to.be.eql('baz');

    const { unprocessed } = await parent.getDependenciesCount({
      unprocessed: true,
    });

    expect(unprocessed).to.be.equal(2);

    await childrenWorker.close();
    await parentWorker.close();
    await parentQueue.close();
    await removeAllQueueData(new IORedis(), parentQueueName);
  });

  it('should process jobs with custom ids', async () => {
    const name = 'test';
    let processor;
    const processing = new Promise<void>(
      resolve =>
        (processor = async (job: Job) => {
          if (job.data.idx === 0) {
            expect(job.data.foo).to.be.equal('bar');
          } else {
            expect(job.data.idx).to.be.equal(1);
            expect(job.data.foo).to.be.equal('baz');
            resolve();
          }
        }),
    );
    const worker = new Worker(queueName, processor, { connection, prefix });
    await worker.waitUntilReady();

    const jobs = await queue.addBulk([
      { name, data: { idx: 0, foo: 'bar' }, opts: { jobId: 'test1' } },
      { name, data: { idx: 1, foo: 'baz' }, opts: { jobId: 'test2' } },
    ]);
    expect(jobs).to.have.length(2);

    expect(jobs[0].id).to.be.eql('test1');
    expect(jobs[0].data.foo).to.be.eql('bar');
    expect(jobs[1].id).to.be.eql('test2');
    expect(jobs[1].data.foo).to.be.eql('baz');

    await processing;
    await worker.close();
  });
});
