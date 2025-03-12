/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as xml2js from 'xml2js';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  private readonly basePath =
    process.env.ROBOT_PATH ?? '/home/opc/dian_automatization/robot';
  private readonly logsPath = path.join(this.basePath, 'logs');
  private readonly outputXmlPath = path.join(this.logsPath, 'output.xml');
  private readonly testsPath = path.join(this.basePath, 'tests');
  private lastStdout: string = '';

  getHello(): string {
    return 'Hello World!';
  }

  async executeRobotTest(url: string): Promise<{
    success: boolean;
    stats?: any;
    errorMessage?: string;
    uuid?: string;
  }> {
    const dockerCommand = `docker run --rm --shm-size=1g \
      --user $(id -u):$(id -g) \
      --network=host \
      -v ${this.basePath}/logs:/opt/robotframework/results:Z \
      -v ${this.basePath}/tests:/opt/robotframework/tests:Z \
      -v ${this.basePath}/resources:/opt/robotframework/resources:Z \
      -v ${this.basePath}/libs:/opt/robotframework/libs:Z \
      -e 'ROBOT_OPTIONS=--variable URL:${url} --outputdir /opt/robotframework/results --loglevel DEBUG' \
      ppodgorsek/robot-framework`;

    this.logger.log(`Ejecutando comando Docker: ${dockerCommand}`);

    try {
      const { stdout, stderr } = await this.execCommand(dockerCommand);
      this.logger.log(`stdout: ${stdout}`);
      if (stderr) this.logger.warn(`stderr: ${stderr}`);

      // Store stdout for possible fallback parsing
      this.lastStdout = stdout;

      // Parse the output.xml file
      let stats;
      let uuid;
      try {
        const result = await this.parseRobotOutputXml();
        stats = result.stats;
        uuid = result.uuid;
      } catch (error) {
        this.logger.warn(`Error parsing XML: ${error.message}`);
        stats = { pass: 0, fail: 0, skip: 0 };
      }

      // If XML parsing failed, try parsing from stdout
      if (stats.pass === 0 && stats.fail === 0 && stats.skip === 0) {
        const stdoutStats = this.parseStatsFromStdout(stdout);
        if (stdoutStats.pass > 0 || stdoutStats.fail > 0) {
          Object.assign(stats, stdoutStats);
        }
      }

      // Check if tests passed or failed based on stats
      const success = stats.pass > 0 && stats.fail === 0;

      // If tests failed but we don't have an error message, try to extract it
      if (!success && !stats.errorMessage) {
        stats.errorMessage = this.extractErrorMessageFromStdout(stdout);
      }

      // If UUID is not available in XML, try to extract from stdout
      if (!uuid) {
        uuid = this.extractUuidFromStdout(stdout);
      }

      // Si hay errores en las pruebas pero aún así se completaron, lanzar HTTP 224
      if (!success && stats.fail > 0) {
        throw new HttpException(
          {
            success: false,
            stats,
            // Don't duplicate errorMessage since it's already in stats
            uuid,
          },
          224,
        );
      }

      return {
        success,
        stats,
        // Avoid duplicating the errorMessage here - remove this line
        // errorMessage: success ? undefined : stats.errorMessage,
        uuid,
      };
    } catch (error) {
      // Si ya es un HttpException, lo propagamos
      if (error instanceof HttpException) {
        throw error;
      }

      // Si el comando falló completamente, retornamos stats null
      this.logger.error('Error ejecutando prueba Robot en Docker:', error);
      throw new InternalServerErrorException({
        success: false,
        output: this.lastStdout || error.message,
        stats: null,
        errorMessage: `Error ejecutando prueba Robot: ${error.message}`,
      });
    }
  }

  // Rest of the methods remain unchanged
  private execCommand(
    command: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          this.logger.error(`Error en ejecución de comando: ${error.message}`);
          this.logger.error(`stdout: ${stdout}`);
          this.logger.error(`stderr: ${stderr}`);

          // En lugar de rechazar con excepción, resolvemos con lo que tenemos
          // para poder procesar mejor el error
          return resolve({
            stdout: stdout || `Error: ${error.message}`,
            stderr,
          });
        }
        resolve({ stdout, stderr });
      });
    });
  }

  private async parseRobotOutputXml(): Promise<{
    stats: { pass: number; fail: number; skip: number; errorMessage?: string };
    uuid?: string;
  }> {
    try {
      await fs.access(this.outputXmlPath);
      const xmlData = await fs.readFile(this.outputXmlPath, 'utf8');

      // Log a sample of the XML for debugging
      this.logger.debug(`XML sample: ${xmlData.substring(0, 500)}...`);

      const parser = new xml2js.Parser({ explicitArray: true });
      const result = await parser.parseStringPromise(xmlData);

      // Check if we have valid statistics
      if (
        !result.robot ||
        !result.robot.statistics ||
        !result.robot.statistics[0] ||
        !result.robot.statistics[0].total
      ) {
        throw new BadRequestException(
          'El XML no contiene estadísticas válidas.',
        );
      }

      // Extract statistics
      const totalStats = result.robot.statistics[0].total[0].stat;
      let pass = 0,
        fail = 0,
        skip = 0;

      // Find the "All Tests" stat
      for (const stat of totalStats) {
        if (stat.$.name === 'All Tests') {
          pass = parseInt(stat.$.pass, 10) || 0;
          fail = parseInt(stat.$.fail, 10) || 0;
          skip = parseInt(stat.$.skip, 10) || 0;
          break;
        }
      }

      // Extract error message if test failed
      let errorMessage;
      if (fail > 0 && result.robot.suite) {
        errorMessage = this.extractErrorMessage(result.robot);
      }

      // Extract UUID from XML
      const uuid = this.extractUuidFromXml(result.robot);

      return {
        stats: { pass, fail, skip, errorMessage },
        uuid,
      };
    } catch (error) {
      this.logger.error('Error leyendo o procesando el XML:', error);
      throw new BadRequestException(
        'Error procesando el resultado de la prueba',
      );
    }
  }

  private extractUuidFromXml(robot: any): string | undefined {
    try {
      if (!robot.suite || !robot.suite[0]) {
        return undefined;
      }

      // Lista para almacenar mensajes que contienen UUID
      const uuidMessages: Array<{ message: string; priority: number }> = [];
      this.traverseSuitesForUuid(robot.suite[0], uuidMessages);

      if (uuidMessages.length > 0) {
        // Ordenar por prioridad (más alta primero)
        uuidMessages.sort((a, b) => b.priority - a.priority);

        // Buscar el patrón UUID en los mensajes encontrados, empezando por los de mayor prioridad
        for (const messageObj of uuidMessages) {
          const uuidMatch = messageObj.message.match(
            /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
          );
          if (uuidMatch) {
            return uuidMatch[0];
          }
        }
      }

      return undefined;
    } catch (error) {
      this.logger.warn('Error extracting UUID from XML:', error);
      return undefined;
    }
  }

  private traverseSuitesForUuid(
    suiteNode: any,
    uuidMessages: Array<{ message: string; priority: number }>,
  ): void {
    // Buscar en mensajes de log que contengan información de UUID
    if (suiteNode.test) {
      for (const test of suiteNode.test) {
        // Buscar en keywords de test
        if (test.kw) {
          this.traverseKeywordsForUuid(test.kw, uuidMessages);
        }
      }
    }

    // Buscar en suites anidadas
    if (suiteNode.suite) {
      for (const suite of suiteNode.suite) {
        this.traverseSuitesForUuid(suite, uuidMessages);
      }
    }
  }

  private traverseKeywordsForUuid(
    keywords: any[],
    uuidMessages: Array<{ message: string; priority: number }>,
  ): void {
    if (!keywords || !keywords.length) return;

    for (const kw of keywords) {
      // Buscar mensajes de log en el keyword
      if (kw.msg) {
        for (const msg of kw.msg) {
          const msgText = msg._ || '';

          // Asignar prioridades según el contenido del mensaje
          let priority = 0;

          // Prioridad máxima: "Extracted UUID:"
          if (msgText.includes('Extracted UUID:')) {
            priority = 100;
          }
          // Menor prioridad: contiene "UUID" pero no es el patrón específico que buscamos
          else if (msgText.includes('UUID') || msgText.includes('uuid')) {
            priority = 50;
          }
          // Prioridad baja: solo contiene un patrón de UUID
          else if (
            /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(
              msgText,
            )
          ) {
            priority = 10;
          }

          // Solo agregar mensajes relevantes
          if (
            priority > 0 &&
            !msgText.includes('xpath') &&
            !msgText.includes('token=')
          ) {
            uuidMessages.push({ message: msgText, priority });
          }
        }
      }

      // Buscar también el valor devuelto por un keyword (para capturar el UUID extraído)
      if (kw.$ && kw.$.name === 'Get Text' && kw.msg) {
        // Buscar el mensaje que contiene el valor extraído
        for (const msg of kw.msg) {
          const msgText = msg._ || '';
          if (
            /\${uuid} = [a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(
              msgText,
            )
          ) {
            uuidMessages.push({ message: msgText, priority: 90 });
          }
        }
      }

      // Buscar en keywords anidados
      if (kw.kw) {
        this.traverseKeywordsForUuid(kw.kw, uuidMessages);
      }
    }
  }

  private extractUuidFromStdout(stdout: string): string | undefined {
    try {
      // Dividir stdout en líneas para procesarlo mejor
      const lines = stdout.split('\n');

      // Buscar líneas que contengan "Extracted UUID:" primero
      const extractedLines = lines.filter((line) =>
        line.includes('Extracted UUID:'),
      );
      if (extractedLines.length > 0) {
        const uuidMatch = extractedLines[0].match(
          /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
        );
        if (uuidMatch) {
          return uuidMatch[0];
        }
      }

      // Buscar líneas que contengan "value":"UUID"
      const valueLines = lines.filter((line) =>
        /\"value\":\"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\"/i.test(
          line,
        ),
      );
      if (valueLines.length > 0) {
        const uuidMatch = valueLines[0].match(
          /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
        );
        if (uuidMatch) {
          return uuidMatch[0];
        }
      }

      // Buscar líneas con "${uuid} ="
      const uuidVarLines = lines.filter((line) => line.includes('${uuid} ='));
      if (uuidVarLines.length > 0) {
        const uuidMatch = uuidVarLines[0].match(
          /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
        );
        if (uuidMatch) {
          return uuidMatch[0];
        }
      }

      // Si no se encuentra en líneas específicas, buscar en líneas con UUID
      const uuidLines = lines.filter(
        (line) =>
          (line.includes('UUID') || line.includes('uuid')) &&
          !line.includes('token=') &&
          !line.includes('xpath'),
      );

      if (uuidLines.length > 0) {
        const uuidMatch = uuidLines[0].match(
          /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
        );
        if (uuidMatch) {
          return uuidMatch[0];
        }
      }

      // Último recurso: buscar cualquier UUID en todo el stdout que no sea un token
      const uuidRegex =
        /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;
      for (const line of lines) {
        if (uuidRegex.test(line) && !line.includes('token=')) {
          const match = uuidRegex.exec(line);
          if (match) {
            return match[0];
          }
        }
      }

      return undefined;
    } catch (error) {
      this.logger.warn('Error extracting UUID from stdout:', error);
      return undefined;
    }
  }

  private parseStatsFromStdout(stdout: string): {
    pass: number;
    fail: number;
    skip: number;
  } {
    try {
      // Look for lines with test summary like "1 test, 1 passed, 0 failed"
      const summaryRegex = /(\d+) test, (\d+) passed, (\d+) failed/;
      const matches = summaryRegex.exec(stdout);

      if (matches && matches.length >= 4) {
        const total = parseInt(matches[1], 10) || 0;
        const pass = parseInt(matches[2], 10) || 0;
        const fail = parseInt(matches[3], 10) || 0;
        const skip = total - (pass + fail);

        return { pass, fail, skip };
      }

      // If no matches, check for PASS/FAIL in the output
      const passCount = (stdout.match(/\| PASS \|/g) || []).length;
      const failCount = (stdout.match(/\| FAIL \|/g) || []).length;

      if (passCount > 0 || failCount > 0) {
        return {
          pass: passCount,
          fail: failCount,
          skip: 0,
        };
      }

      return { pass: 0, fail: 0, skip: 0 };
    } catch (error) {
      this.logger.warn('Error parsing stats from stdout:', error);
      return { pass: 0, fail: 0, skip: 0 };
    }
  }

  private extractErrorMessageFromStdout(stdout: string): string | undefined {
    try {
      // Look for FAIL followed by error message
      const failureRegex = /\| FAIL \|\s*\n(.*?)(?=\n-{10,}|\n={10,}|$)/s;
      const matches = failureRegex.exec(stdout);

      if (matches && matches.length >= 2) {
        return matches[1].trim();
      }

      // Try to find traceback or error message patterns
      const errorRegex = /Element with locator .* not found/;
      const errorMatch = errorRegex.exec(stdout);
      if (errorMatch) {
        return errorMatch[0];
      }

      return undefined;
    } catch (error) {
      this.logger.warn('Error extracting error message from stdout:', error);
      return undefined;
    }
  }

  private extractErrorMessage(robot: any): string | undefined {
    try {
      // Navigate through the XML structure to find test failures
      if (!robot.suite || !robot.suite[0]) {
        return undefined;
      }

      const errorMessages: string[] = [];
      this.traverseSuites(robot.suite[0], errorMessages);

      return errorMessages.length > 0 ? errorMessages[0] : undefined;
    } catch (error) {
      this.logger.warn('Error extracting failure message from XML:', error);
      return undefined;
    }
  }

  private traverseSuites(suiteNode: any, errorMessages: string[]): void {
    // Check for test failures
    if (suiteNode.test) {
      for (const test of suiteNode.test) {
        if (
          test.status &&
          test.status[0] &&
          test.status[0].$.status === 'FAIL'
        ) {
          if (test.status[0]._) {
            errorMessages.push(test.status[0]._);
          }
        }

        // Check keywords in tests
        if (test.kw) {
          this.traverseKeywords(test.kw, errorMessages);
        }
      }
    }

    // Check nested suites
    if (suiteNode.suite) {
      for (const suite of suiteNode.suite) {
        this.traverseSuites(suite, errorMessages);
      }
    }
  }

  private traverseKeywords(keywords: any[], errorMessages: string[]): void {
    if (!keywords || !keywords.length) return;

    for (const kw of keywords) {
      // Check for keyword failures
      if (kw.status && kw.status[0] && kw.status[0].$.status === 'FAIL') {
        if (kw.status[0]._) {
          errorMessages.push(kw.status[0]._);
        }
      }

      // Check nested keywords
      if (kw.kw) {
        this.traverseKeywords(kw.kw, errorMessages);
      }
    }
  }
}
