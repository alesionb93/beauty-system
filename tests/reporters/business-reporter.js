// tests/reporters/business-reporter.js
// Reporter minimalista para QA

class BusinessReporter {

  constructor() {
    this.results = [];
    this.startedAt = null;
  }

  onBegin(config, suite) {

    this.startedAt = Date.now();

    process.stdout.write(
      `\nRunning ${suite.allTests().length} tests using 1 worker\n\n`
    );
  }

  onTestEnd(test, result) {

    this.results.push({
      title: test.title,
      status: result.status,
      duration: result.duration
    });

    const icon =
      result.status === 'passed' ? '✅' :
      result.status === 'failed' ? '❌' :
      result.status === 'skipped' ? '⏭️' :
      '⚠️';

    const secs =
      (result.duration / 1000).toFixed(1);

    process.stdout.write(
      `${icon} ${test.title} (${secs}s)\n`
    );

    if (
      result.status === 'failed' &&
      result.error
    ) {

      process.stdout.write('\n');

      process.stdout.write(
        '━━━━━━━━ FALHA ━━━━━━━━\n\n'
      );

      process.stdout.write(
        `📌 Teste: ${test.title}\n\n`
      );

      process.stdout.write(
        `💥 Erro:\n${result.error.message}\n\n`
      );

      const screenshot =
        result.attachments?.find(
          a =>
            a.name === 'screenshot' ||
            a.contentType?.startsWith('image/')
        );

      const video =
        result.attachments?.find(
          a =>
            a.name === 'video' ||
            a.contentType?.startsWith('video/')
        );

      const trace =
        result.attachments?.find(
          a =>
            a.name === 'trace' ||
            a.path?.includes('trace')
        );

      if (screenshot?.path) {

        process.stdout.write(
          `📸 Screenshot:\n${screenshot.path}\n\n`
        );

      }

      if (video?.path) {

        process.stdout.write(
          `🎥 Vídeo:\n${video.path}\n\n`
        );

      }

      if (trace?.path) {

        process.stdout.write(
          `🕵️ Trace:\n${trace.path}\n\n`
        );

      }

      process.stdout.write(
        '━━━━━━━━━━━━━━━━━━━━━━━\n\n'
      );
    }
  }

  onEnd() {

    const total =
      this.results.length;

    const ok =
      this.results.filter(
        r => r.status === 'passed'
      ).length;

    const ko =
      this.results.filter(
        r => r.status === 'failed'
      ).length;

    const skipped =
      this.results.filter(
        r => r.status === 'skipped'
      ).length;

    const dur =
      ((Date.now() - this.startedAt) / 1000)
        .toFixed(1);

    process.stdout.write('\n');

    process.stdout.write(
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n'
    );

    process.stdout.write(
      '📊 RESUMO\n\n'
    );

    process.stdout.write(
      `📋 Executados: ${total}\n`
    );

    process.stdout.write(
      `✅ Sucesso:    ${ok}\n`
    );

    process.stdout.write(
      `❌ Falhas:     ${ko}\n`
    );

    process.stdout.write(
      `⏭️ Ignorados:  ${skipped}\n`
    );

    process.stdout.write(
      `⏱ Duração:    ${dur}s\n\n`
    );

    if (ko > 0) {

      process.stdout.write(
        '🔎 Para detalhes completos:\n'
      );

      process.stdout.write(
        'npx playwright show-report\n\n'
      );

    }
  }

}

module.exports = BusinessReporter;