/*
 * Copyright (c) 2010-2026 Haifeng Li. All rights reserved.
 *
 * SMILE Serve is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * SMILE Serve is distributed in the hope that it will be useful,
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with SMILE. If not, see <https://www.gnu.org/licenses/>.
 */
package smile.daemon;

import ioa.llm.tool.Bash;
import ioa.llm.tool.Read;
import ioa.llm.tool.SQL;
import ioa.llm.tool.DataViz;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Verifies ToolPresenter maps concrete tools to the right protocol kind + input preview
 * (refinement R2), replacing the prior hardcoded kind="script"/code=null.
 *
 * @author Haifeng Li
 */
public class ToolPresenterTest {

    @Test
    public void bashMapsToShellKindWithCommandPreview() {
        var b = new Bash();
        b.command = "python3 train.py --epochs 10";
        var card = ToolPresenter.present(b);
        assertEquals("shell", card.kind());
        assertEquals("python3 train.py --epochs 10", card.code());
        assertTrue(card.title().contains("python3 train.py"));
    }

    @Test
    public void readMapsToReadKindWithPath() {
        var r = new Read();
        r.file_path = "input/churn.csv";
        var card = ToolPresenter.present(r);
        assertEquals("read", card.kind());
        assertEquals("input/churn.csv", card.code());
        assertTrue(card.title().contains("input/churn.csv"));
    }

    @Test
    public void sqlPrefersStatementForCode() {
        var s = new SQL();
        s.statement = "SELECT count(*) FROM churn";
        var card = ToolPresenter.present(s);
        assertEquals("sql", card.kind());
        assertEquals("SELECT count(*) FROM churn", card.code());
    }

    @Test
    public void sqlCreateTableSurfacesTableNameInTitle() {
        var s = new SQL();
        s.statement = "CREATE OR REPLACE TABLE churn_active AS SELECT * FROM churn WHERE active";
        var card = ToolPresenter.present(s);
        assertEquals("sql", card.kind());
        assertEquals("SQL → churn_active", card.title());
    }

    @Test
    public void dataVizMapsToDataVizKind() {
        var d = new DataViz();
        d.plot = "scatter";
        d.x = "tenure";
        d.y = "MonthlyCharges";
        var card = ToolPresenter.present(d);
        assertEquals("dataviz", card.kind());
        assertTrue(card.code().contains("scatter"));
        assertTrue(card.code().contains("x=tenure"));
    }

    @Test
    public void unknownToolFallsBackToScriptKindNoCode() {
        // An anonymous Tool implementation the presenter doesn't recognize.
        Object unknown = new Object();
        var card = ToolPresenter.present(unknown);
        assertEquals("script", card.kind());
        assertNull(card.code());
    }
}
