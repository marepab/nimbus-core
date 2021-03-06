/**
* @license
* Copyright 2016-2018 the original author or authors.
*
 * Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
 *        http://www.apache.org/licenses/LICENSE-2.0
*
 * Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
'use strict';

import {
    Component, Input, Output, forwardRef, ViewChild, EventEmitter,
    ViewEncapsulation, ChangeDetectorRef, QueryList, ViewChildren
} from '@angular/core';
import { FormGroup, NG_VALUE_ACCESSOR } from '@angular/forms';
import { ControlValueAccessor } from '@angular/forms/src/directives';
import { Subscription } from 'rxjs/Subscription';
import { OverlayPanel, Paginator } from 'primeng/primeng';
import { Table } from 'primeng/table';
import { Observable } from 'rxjs/Observable';
import 'rxjs/add/observable/fromEvent';
import * as moment from 'moment';

import { ParamUtils } from './../../../shared/param-utils';
import { WebContentSvc } from '../../../services/content-management.service';
import { DateTimeFormatPipe } from '../../../pipes/date.pipe';
import { BaseElement } from './../base-element.component';
import { GenericDomain } from '../../../model/generic-domain.model';
import { ParamConfig } from '../../../shared/param-config';
import { PageService } from '../../../services/page.service';
import { GridService } from '../../../services/grid.service';
import { ServiceConstants } from './../../../services/service.constants';
import { SortAs, GridColumnDataType } from './sortas.interface';
import { ActionDropdown } from './../form/elements/action-dropdown.component';
import { Param } from '../../../shared/param-state';
import { HttpMethod } from './../../../shared/command.enum';
import { ViewComponent } from '../../../shared/param-annotations.enum';

export const CUSTOM_INPUT_CONTROL_VALUE_ACCESSOR: any = {
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => DataTable),
    multi: true
};

/**
* \@author Dinakar.Meda
* \@whatItDoes
 *
 * \@howToUse
 *
 */
@Component({
    selector: 'nm-table',
    providers: [CUSTOM_INPUT_CONTROL_VALUE_ACCESSOR, WebContentSvc, DateTimeFormatPipe],
    encapsulation: ViewEncapsulation.None,
    templateUrl: './table.component.html'
})
export class DataTable extends BaseElement implements ControlValueAccessor {

    @Output() onScrollEvent: EventEmitter<any> = new EventEmitter();
    @Input() params: ParamConfig[];
    @Input() form: FormGroup;
    @Input('value') _value = [];
    filterValue: Date;
    totalRecords: number = 0;
    mouseEventSubscription: Subscription;
    filterState: any[] = [];
    columnsToShow: number = 0;

    @ViewChild('dt') dt: Table;
    @ViewChild('op') overlayPanel: OverlayPanel;
    @ViewChildren('dropDown') dropDowns: QueryList<any>;

    summaryData: any;
    rowHover: boolean;
    selectedRows: any[];
    showFilters: boolean = false;
    hasFilters: boolean = false;
    filterTimeout: any;
    rowStart = 0;
    rowEnd = 0;
    rowExpanderKey = '';
    public onChange: any = (_) => { /*Empty*/ }
    public onTouched: any = () => { /*Empty*/ }
    defaultPattern: RegExp = /^[ A-Za-z0-9_@./#&+-,()!%_{};:?.<>-]*$/;
    numPattern: RegExp = /[\d\-\.]/;

    get value() {
        return this._value;
    }

    set value(val) {
        this._value = val;
        this.onChange(val);
        this.onTouched();
    }

    public writeValue(obj: any): void {
        if (obj !== undefined) {
        }
        this.cd.markForCheck();
    }

    public registerOnChange(fn: any): void {
        this.onChange = fn;
    }

    public registerOnTouched(fn: any): void {
        this.onTouched = fn;
    }

    fg = new FormGroup({}); // TODO this is for the filter controls that need to be embedded in the grid
    private imagesPath: string;

    constructor(
        private pageSvc: PageService,
        private _wcs: WebContentSvc,
        private gridService: GridService,
        private dtFormat: DateTimeFormatPipe,
        private cd: ChangeDetectorRef) {

        super(_wcs);
    }

    ngOnInit() {
        super.ngOnInit();
        // non-hidden columns
        this.columnsToShow = 0;
        // Set the column headers
        if (this.params) {
            this.params.forEach(column => {
                column.label = this._wcs.findLabelContentFromConfig(column.code, column.labelConfigs).text;
                // Set field and header attributes. TurboTable expects these specific variables.
                column['field'] = column.code;
                column['header'] = column.label;
                if(column.uiStyles) {
                    if (column.uiStyles.attributes.filter) {
                        this.hasFilters = true;
                    }
                    if (column.uiStyles.attributes.hidden) {
                        column['exportable'] = false;
                    } else {
                        this.columnsToShow ++;
                        if (column.uiStyles.attributes.alias == 'LinkMenu' || column.type.nested == true) {
                            column['exportable'] = false;
                        } else {
                            column['exportable'] = true;
                        }
                    }
                    if (column.uiStyles.attributes.rowExpander) {
                        this.rowExpanderKey = column.code;
                    }
                }
            });
        }
        // include row selection checkbox to column count
        if (this.element.config.uiStyles && this.element.config.uiStyles.attributes.rowSelection) {
            this.columnsToShow ++;
        }

        if (this.element.gridList != null && this.element.gridList.length > 0) {
            this.value = this.element.gridList;
            this.totalRecords = this.value.length;
            this.updatePageDetailsState();
        }

        if (this.dt !== undefined) {

            const customFilterConstraints = this.dt.filterConstraints;
            customFilterConstraints['between'] = this.between;
            this.dt.filterConstraints = customFilterConstraints;
        }

    }

    ngAfterViewInit() {
        this.imagesPath = ServiceConstants.IMAGES_URL;
        if (this.params != null) {
            this.params.forEach(element => {
                if (element != null) {
                    if (element.uiStyles && element.uiStyles.attributes &&
                        element.uiStyles.attributes.filterValue && element.uiStyles.attributes.filterValue !== '') {
                        let filterValue = element.uiStyles.attributes.filterValue;
                        this.dt.filter(filterValue, element.code, element.uiStyles.attributes.filterMode);
                    }
                }
            });
        }

        if (this.element.config.uiStyles && this.element.config.uiStyles.attributes.onLoad === true) {
            // If table is set to lazyload, the loadDataLazy(event) method will handle the initialization
            if (!this.element.config.uiStyles.attributes.lazyLoad) {
                let queryString: string = this.getQueryString(0, undefined);
                this.pageSvc.processEvent(this.element.path, '$execute', new GenericDomain(), 'GET', queryString);
            }
        }

        this.rowHover = true;
        this.gridService.eventUpdate$.subscribe(data => {
            this.summaryData = data;
        });

        this.pageSvc.gridValueUpdate$.subscribe(event => {
            if (event.path == this.element.path) {
                this.value = event.gridList;
                let gridListSize = this.value ? this.value.length : 0;
                // Check for Server Pagination Vs Client Pagination
                if (this.element.config.uiStyles && this.element.config.uiStyles.attributes.lazyLoad) {
                    // Server Pagination
                    this.totalRecords = event.page.totalElements;
                    if (event.page.first) {
                        this.updatePageDetailsState();
                    }
                } else {
                    // Client Pagination
                    this.totalRecords = this.value ? this.value.length : 0;
                    this.updatePageDetailsState();
                    this.dt.first = 0;
                }

                this.cd.markForCheck();
                this.resetMultiSelection();
            }
        });

        if (this.form != undefined && this.form.controls[this.element.config.code] != null) {
            this.pageSvc.validationUpdate$.subscribe(event => {
                let frmCtrl = this.form.controls[event.config.code];
                if (frmCtrl != null && event.path == this.element.path) {
                    if (event.enabled)
                        frmCtrl.enable();
                    else
                        frmCtrl.disable();
                }
            });
        }

    }
    isRowExpanderHidden(rowData: any): boolean {
        if(this.rowExpanderKey == '')
            return true;
        let val = rowData[this.rowExpanderKey];
        if(val)
            return true;
        else
            return false;
    }

    getCellDisplayValue(rowData: any, col: ParamConfig) {
        let cellData = rowData[col.code];
        if (cellData) {
            if (super.isDate(col.type.name)) {
                return this.dtFormat.transform(cellData, col.uiStyles.attributes.datePattern, col.type.name);
            } else {
                return cellData;
            }
        } else {
            return col.uiStyles.attributes.placeholder;
        }
    }

    showHeader(col: ParamConfig) {
        if (col.uiStyles && col.uiStyles.attributes.hidden == false && col.uiStyles.attributes.alias != ViewComponent.gridRowBody.toString()) {
            return true;
        } 
        return false;
    }

    showValue(col: ParamConfig) {
        if (col.uiStyles && col.uiStyles.attributes.alias != 'Link' && col.uiStyles.attributes.alias != 'LinkMenu' && col.type.nested == false) {
            return true;
        }
        return false;
    }

    showLink(col: ParamConfig) {
        if (col.uiStyles && col.uiStyles.attributes.alias == 'Link') {
            return true;
        }
        return false;
    }

    showLinkMenu(col: ParamConfig) {
        if (col.uiStyles && col.uiStyles.attributes.alias == 'LinkMenu') {
            return true;
        }
        return false;
    }

    isClickedOnDropDown(dropDownArray: Array<ActionDropdown>, target: any) {

        for (var i = 0; i < dropDownArray.length; i++) {
            if (dropDownArray[i].elementRef.nativeElement.contains(target))
                return true;
        }
        return false;

    }

    isActive(index) {
        if (this.filterState[index] != '' && this.filterState[index] != undefined) return true;
        else return false;
    }

    getLinkMenuParam(col, rowIndex): Param {
        return this.element.collectionParams.find(ele => ele.path == this.element.path + '/'+rowIndex+'/' + col.code && ele.alias == ViewComponent.linkMenu.toString());
    }

    getRowPath(col: ParamConfig, item: any) {
        return this.element.path + '/' + item.elemId + '/' + col.code;
    }

    processOnClick(col: ParamConfig, item: any) {
        let uri = this.element.path + '/' + item.elemId + '/' + col.code;

        let uriParams = this.getAllURLParams(uri);
        if (uriParams != null) {
            for (let uriParam of uriParams) {
                let p = uriParam.substring(1, uriParam.length - 1);
                if (item[p]) {
                    uri = uri.replace(new RegExp(uriParam, 'g'), item[p]);
                }
            }
        }
        this.pageSvc.processEvent(uri, col.uiStyles.attributes.b, item, col.uiStyles.attributes.method);
    }

    /* look for parameters in URI {} */
    getAllURLParams(uri: string): string[] {
        var pattern = /{([\s\S]*?)}/g;
        return uri.match(pattern);
    }

    toggleFilter(event: any) {
        this.showFilters = !this.showFilters;
    }

    postGridData(obj) {
        let item: GenericDomain = new GenericDomain();
        let elemIds = [];
        this.selectedRows.forEach(element => {
            elemIds.push(element.elemId);
        });

        item.addAttribute(this.element.config.uiStyles.attributes.postButtonTargetPath, elemIds);
        this.pageSvc.processEvent(this.element.config.uiStyles.attributes.postButtonUrl, null, item, 'POST');
    }

    onRowSelect(event) {
    }

    onRowUnselect(event) {
    }

    onRowClick(event: any) {
    }

    postOnChange(col: ParamConfig, item: any) {
        let uri = this.element.path + '/' + item.elemId + '/' + col.code;
        this.pageSvc.postOnChange(uri, 'state', JSON.stringify(event.target['checked']));
    }

    handleRowChange(val) {
    }

    getAddtionalData(event: any) { 
        event.data['nestedElement'] = this.element.collectionParams.find(ele => ele.path == this.element.path + '/' + event.data.elemId + '/' + ele.config.code && ele.alias == ViewComponent.gridRowBody.toString()); 
    }

    resetMultiSelection() {
        this.selectedRows = [];
    }

    customSort(event: any) {
        let fieldType: string = event.field.type.name;
        let sortAs: string = event.field.uiStyles.attributes.sortAs;
        if (this.isSortAsNumber(fieldType, sortAs)) {
            this.sortInternal(fieldValue => {
                if (fieldValue != null && fieldValue !== undefined)
                    return Number(fieldValue);
                else
                    return null;
            }, event);
        }
        else if (this.isSortAsDate(fieldType, sortAs)) {
            this.sortInternal(fieldValue => {
                if (fieldValue != null && fieldValue !== undefined)
                    return new Date(fieldValue);
                else
                    return null;
            }, event);
        }
        else {
            // all else are sorted as string using localeCompare
            this.value.sort((item1: any, item2: any) => {
                let value1 = item1[event.field.code] !== undefined ? item1[event.field.code] : null;
                let value2 = item2[event.field.code] !== undefined ? item2[event.field.code] : null;

                if (value1 == null && value2 == null)
                    return 0;
                if (value1 == null && value2 != null)
                    return -1 * event.order;
                else if (value1 != null && value2 == null)
                    return 1 * event.order;

                return value1.localeCompare(value2) * event.order;
            });
        }
    }

    protected sortInternal(itemCallback: Function, event: any): Array<any> {
        return this.value.sort((item1: any, item2: any) => {
            let value1 = itemCallback(item1[event.field.code]);
            let value2 = itemCallback(item2[event.field.code]);

            if (value1 == null && value2 == null)
                return 0;
            if (value1 == null && value2 != null)
                return -1 * event.order;
            if (value1 != null && value2 == null)
                return 1 * event.order;

            if (value1 > value2) {
                return 1 * event.order;
            }
            if (value1 < value2) {
                return -1 * event.order;
            }
            return 0;
        });
    }

    protected isSortAsNumber(fieldType: string, sortAs: string): boolean {
        let fieldTypeToMatch = fieldType.toLowerCase();
        return ((sortAs !== null && sortAs === SortAs.number.value) || fieldTypeToMatch === GridColumnDataType.int.value || fieldTypeToMatch === GridColumnDataType.integer.value
            || fieldTypeToMatch === GridColumnDataType.long.value || fieldTypeToMatch === GridColumnDataType.double.value);

    }

    protected isSortAsDate(fieldType: string, sortAs: string): boolean {
        let fieldTypeToMatch = fieldType.toLowerCase();
        return ((sortAs !== null && sortAs === SortAs.date.value) || fieldTypeToMatch === GridColumnDataType.date.value || fieldTypeToMatch === GridColumnDataType.localdate.value
            || fieldTypeToMatch === GridColumnDataType.localdatetime.value || fieldTypeToMatch === GridColumnDataType.zoneddatetime.value);

    }

    between(value: any, filter: any) {
        return moment(filter).isSame(value, 'day');
    }

    dateFilter(e: any, dt: Table, field: string, datePattern?: string, dateType?: string) {

        let dtPattern = datePattern? datePattern : ParamUtils.getDateFormatForType(dateType);
       
        if (moment(e.toLocaleDateString(), dtPattern.toUpperCase(), false).isValid()) {
            dt.filter(moment(e.toLocaleDateString(), dtPattern.toUpperCase()).toDate(), field, "between");
        }
       
        this.updatePageDetailsState();
    }

    inputFilter(e: any, dt: Table, field: string, filterMatchMode: string) {
        // Wait for 500 ms before triggering the filter. This is to give time for the user to enter the criteria 
        if (this.filterTimeout) {
            clearTimeout(this.filterTimeout);
        }

        this.filterTimeout = setTimeout(() => {
            dt.filter(e.target.value, field, filterMatchMode);
        }, 500);
    }

    clearFilter(txt: any, dt: Table, field: string, index) {
        txt.value = '';
        dt.filter(txt.value, field, "");
    }

    clearAll() {
        this.filterState = [];
        this.dt.reset();
    }

    paginate(e: any) {
        let first: number = parseInt(e.first);
        let rows: number = parseInt(e.rows);
        this.rowStart = first + 1;
        if (first + rows < this.totalRecords) {
            this.rowEnd = first + rows;
        } else  {
            this.rowEnd = this.totalRecords;
        }
    }

    updatePageDetailsState() {
        if (this.totalRecords != 0) {
            this.rowStart = 1;
            this.rowEnd = this.totalRecords < +this.element.config.uiStyles.attributes.pageSize ? this.totalRecords : +this.element.config.uiStyles.attributes.pageSize;
        }
        else {
            this.rowStart = 0; this.rowEnd = 0;
        }
    }

    filterCallBack(e: any) {
        this.totalRecords = e.filteredValue.length;
        this.updatePageDetailsState();
    }

    toggleOpen(e: any) {

        let selectedDropDownIsOpen = e.isOpen;
        let selectedDropDownState = e.state;

        if (this.dropDowns)
            this.dropDowns.toArray().forEach((item) => {
                if (!item.selectedItem) {
                    item.isOpen = false;
                    item.state = 'closedPanel';
                }
            });

        e.isOpen = !selectedDropDownIsOpen;

        if (selectedDropDownState == 'openPanel') {
            e.state = 'closedPanel';
            if (!this.mouseEventSubscription.closed)
                this.mouseEventSubscription.unsubscribe();
        }
        else {
            e.state = 'openPanel';
            if (this.dropDowns && (this.mouseEventSubscription == undefined || this.mouseEventSubscription.closed))
                this.mouseEventSubscription =
                    Observable.fromEvent(document, 'click').filter((event: any) =>
                        !this.isClickedOnDropDown(this.dropDowns.toArray(), event.target)).first().subscribe(() => {
                            this.dropDowns.toArray().forEach((item) => {
                                item.isOpen = false;
                                item.state = 'closedPanel';
                            });
                            this.cd.detectChanges();
                        });
        }
        e.selectedItem = false;
        this.cd.detectChanges();
    }

    export() {
        let exportDt = this.dt;
        let dtCols = this.params.filter(col => (col.type != null && ParamUtils.isKnownDateType(col.type.name) != null))
        if (dtCols != null && dtCols.length > 0) {
            let tblData: any[] = exportDt.filteredValue || exportDt.value;
            tblData.forEach(row => {
                for (var key in row) {
                    if (row.hasOwnProperty(key)) {
                        if (row[key] instanceof Date) {
                            let col = dtCols.filter(cd => cd.code == key)
                            if (col != null && col.length > 0) {
                                row[key] = this.dtFormat.transform(row[key], col[0].uiStyles.attributes.datePattern, col[0].type.name);
                            }
                        }
                    }
                }
            });
            exportDt.filteredValue = tblData;
        }
        exportDt.exportCSV();
    }

    ngOnDestroy() {
        if (this.mouseEventSubscription)
            this.mouseEventSubscription.unsubscribe();
        this.cd.detach();
    }

    loadDataLazy(event:any) {
        let pageSize: number = this.element.config.uiStyles.attributes.pageSize;
        let pageIdx: number = 0;        
        let first: number = event.first;
        if (first != 0 ) {
            pageIdx = first/pageSize;
        } else {
            pageIdx = 0;
        }

        // Sort Logic
        let sortBy: string = undefined;
        if (event.sortField) {
            let order: number = event.sortOrder;
            let sortField: string = event.sortField.code;
            let sortOrder: string = 'ASC';
            if (order != 1) {
                sortOrder = 'DESC';
            }
            sortBy = sortField + ',' + sortOrder;    
        }

        // Filter Logic
        let filterCriteria: any[] = [];
        let filterKeys: string[] = [];
        if (event.filters) {
            filterKeys = Object.keys(event.filters);
        }
        filterKeys.forEach(key => {
            let filter: any = {};
            filter['code'] = key;
            filter['value'] = event.filters[key].value;
            filterCriteria.push(filter);
        })
        let payload: GenericDomain = new GenericDomain();
        if (filterCriteria.length > 0) {
            payload.addAttribute('filters', filterCriteria);
        }
        // query params - &pageSize=5&page=0&sortBy=attr_String,DESC
        // request body - filterCriteria
        let queryString: string = this.getQueryString(pageIdx, sortBy);
        this.pageSvc.processEvent(this.element.path, '$execute', payload, HttpMethod.POST.value, queryString);

    }

    getQueryString(pageIdx: number, sortBy: string): string {
        let queryString: string = '';
        let pageSize: number = this.element.config.uiStyles.attributes.pageSize;
        if (sortBy) {
            queryString = queryString + '&sortBy=' + sortBy;
        }
        if (pageIdx !== undefined) {
            queryString = queryString + '&pageSize=' + pageSize + '&page=' + pageIdx;
        }
        return queryString;
    }

    getPattern(dataType: string): any {
        if(this.isSortAsNumber(dataType, null)) {
            return this.numPattern;
        } else {
            return this.defaultPattern;
        }
    }
}
